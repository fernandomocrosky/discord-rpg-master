// Plays a session with simulated players against the real game. It only uses the public game
// actions, so it also covers what Discord would call. Players never see the GM's secrets.
import type { GenerateInput, GenerateResult } from '../llm/client.ts';
import type { CallToAction } from '../orchestrator/call-to-action.ts';
import { createGame, type Generate, type Narration, type RoundProgress } from '../orchestrator/game.ts';
import type { Rng } from '../rules/dice.ts';
import type { CampaignStore } from '../state/store.ts';
import type { SimEvent } from './metrics.ts';
import type { Scenario, SimPlayer } from './scenarios.ts';

const CHANNEL = '1';
const PLAYER_LOG_WINDOW = 10; // recent public events a simulated player remembers

export interface SimUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface SimResult {
  events: SimEvent[];
  summary: string | null;
  gm: SimUsage;
  players: SimUsage;
  stopReason: 'responses' | 'budget';
}

export interface SimOptions {
  scenario: Scenario;
  store: CampaignStore;
  generate: Generate;
  rng: Rng;
  maxResponses: number;
  budgetTokens: number; // no new LLM call starts after this many tokens
}

class BudgetExceeded extends Error {}

type CheckCall = Extract<CallToAction, { kind: 'check' }>;

/** Mulberry32: seeded RNG, so dice and player behavior repeat for the same seed. */
export function seededRng(seed: number): Rng {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function simulate({ scenario, store, generate, rng, maxResponses, budgetTokens }: SimOptions): Promise<SimResult> {
  const events: SimEvent[] = [];
  const gm: SimUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const playersUsage: SimUsage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  let lastGmText = '';

  const metered = (usage: SimUsage) => async (input: GenerateInput): Promise<GenerateResult> => {
    const spent = gm.inputTokens + gm.outputTokens + playersUsage.inputTokens + playersUsage.outputTokens;
    if (spent >= budgetTokens) throw new BudgetExceeded();
    const result = await generate(input);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    usage.calls++;
    return result;
  };
  const generateGm = metered(gm);
  const generatePlayer = metered(playersUsage);
  const game = createGame({
    store,
    rng,
    generate: async (input) => {
      const result = await generateGm(input);
      lastGmText = result.text;
      return result;
    },
  });

  let responses = 0;
  let last!: Narration;

  const recordGm = (narration: Narration) => {
    events.push({ kind: 'gm', rawText: lastGmText, narration });
    last = narration;
    responses++;
  };
  /** True when the GM answered, ending what the table was waiting for. */
  const answered = (progress: RoundProgress) => {
    if (progress.status === 'narrated') recordGm(progress.narration);
    return progress.status === 'narrated';
  };

  /** Everyone declares; quiet players may stay silent, and then someone resolves the round, as the button does. */
  const playRound = async () => {
    const present = scenario.players.filter((player) => {
      const silent = rng() < player.silence;
      if (silent) events.push({ kind: 'silence', userId: player.userId, name: player.name });
      return !silent;
    });
    const acting = present.length ? present : scenario.players.slice(0, 1);
    for (const player of acting) {
      const text = await playerLine(player, events, generatePlayer);
      events.push({ kind: 'action', userId: player.userId, name: player.name, text });
      if (answered(await game.playerAction(CHANNEL, player.userId, text))) return;
    }
    events.push({ kind: 'round-closed' });
    recordGm(await game.resolveRound(CHANNEL, acting[0]!.userId));
  };

  /** Everyone asked rolls; a player who does not is dropped when the round is resolved. */
  const playChecks = async (checks: CheckCall[]) => {
    let roller: SimPlayer | undefined;
    for (const call of checks) {
      const player = scenario.players.find((p) => p.userId === call.userId)!;
      if (rng() < player.silence) {
        events.push({ kind: 'missed-check', userId: player.userId, name: player.name });
        continue;
      }
      roller = player;
      const { check, progress } = await game.playerCheck(CHANNEL, player.userId, call.attribute, call.difficulty);
      events.push({ kind: 'check', userId: player.userId, name: player.name, check });
      if (answered(progress)) return;
    }
    events.push({ kind: 'round-closed' });
    recordGm(await game.resolveRound(CHANNEL, (roller ?? scenario.players[0]!).userId));
  };

  let stopReason: SimResult['stopReason'] = 'responses';
  let summary: string | null = null;
  try {
    await game.newCampaign(CHANNEL, { setting: scenario.setting, tone: scenario.tone, hook: scenario.hook });
    for (const { userId, name, concept, profile } of scenario.players) {
      await game.createCharacter(CHANNEL, userId, { name, concept, profile });
    }
    const started = await game.startSession(CHANNEL, scenario.players.map((p) => p.userId));
    if (started.status !== 'started') throw new Error('Simulated session did not start.');
    recordGm(started.narration);

    while (responses < maxResponses) {
      const checks = last.calls.filter((call): call is CheckCall => call.kind === 'check');
      if (checks.length) await playChecks(checks);
      else await playRound();
    }
    summary = (await game.endSession(CHANNEL)).summary;
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    stopReason = 'budget';
  }
  return { events, summary, gm, players: playersUsage, stopReason };
}

async function playerLine(player: SimPlayer, events: SimEvent[], generate: Generate): Promise<string> {
  const log = events.slice(-PLAYER_LOG_WINDOW).map(publicText).join('\n\n');
  const { text } = await generate({
    system:
      `Você é um jogador em uma mesa de RPG, em português do Brasil. Seu personagem é ${player.name}: ${player.concept}. ${player.style}\n` +
      'Responda só com o que seu personagem tenta fazer ou dizer agora, em primeira pessoa e em no máximo 2 frases. Sem aspas, sem explicações.',
    messages: [{ role: 'user', content: `O que aconteceu até agora na mesa:\n\n${log}\n\nO que ${player.name} faz?` }],
    maxTokens: 1000,
  });
  return text.trim();
}

/** What every player at the table can see. */
function publicText(event: SimEvent): string {
  switch (event.kind) {
    case 'gm':
      return `Mestre: ${event.narration.text}`;
    case 'action':
      return `${event.name}: ${event.text}`;
    case 'silence':
      return `${event.name} não declarou nada.`;
    case 'check':
      return `${event.name} rolou ${event.check.total} contra dificuldade ${event.check.difficulty}.`;
    case 'missed-check':
      return `${event.name} não rolou o teste.`;
    case 'round-closed':
      return 'A rodada foi fechada.';
  }
}

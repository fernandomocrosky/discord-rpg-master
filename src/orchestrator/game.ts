// Game actions used by the Discord commands (and, later, by the mobile app).
// Each GM call runs inside store.update, so actions on the same channel are handled one at a time.
import type { GenerateInput, GenerateResult } from '../llm/client.ts';
import {
  OPEN_SCENE_INSTRUCTION,
  RESUME_SESSION_INSTRUCTION,
  SECRETS_PROMPT,
  SUMMARY_PROMPT,
} from '../llm/prompts.ts';
import { ATTRIBUTE_LABELS, buildAttributes, describeCheck, rollCheck, type Attribute, type Attributes, type CheckResult } from '../rules/checks.ts';
import { describeRoll, rollDice, type RollResult, type Rng } from '../rules/dice.ts';
import {
  addParticipant,
  appendHistory,
  characterAttributes,
  charactersAtTable,
  clearPendingCheck,
  createCampaign,
  currentSession,
  declare,
  endSession,
  flushRound,
  lastSummary,
  pendingChecks,
  recordSetupUsage,
  recordUsage,
  roundDeadline,
  roundEntries,
  sessionHistory,
  setCharacter,
  setPendingCheck,
  setRoundDeadline,
  setSecrets,
  startSession,
  undeclared,
  type Campaign,
  type Character,
  type RoundEntry,
  type TokenUsage,
} from '../state/campaign.ts';
import type { CampaignStore } from '../state/store.ts';
import { buildContext, formatEntry } from './context.ts';
import { parseCallsToAction, type CallToAction } from './call-to-action.ts';
import { campaignStatus, type CampaignStatus } from './status.ts';

export type Generate = (input: GenerateInput) => Promise<GenerateResult>;

/** Error whose message is meant for the player (pt-BR). Anything else is an internal error. */
export class GameError extends Error {}

/** How long a round (or a set of checks) waits for players who have not answered. */
export const ROUND_TIME_MS = 3 * 60 * 1000;

/** What the GM said (without its closing lines) and who it called. `deadline` is set when it asked for checks. */
export interface Narration {
  text: string;
  calls: CallToAction[];
  deadline?: Date;
}

/** Result of anything a player does: the GM answered, or the round is still waiting for someone. */
export type RoundProgress =
  | { status: 'narrated'; narration: Narration }
  | {
      status: 'waiting';
      rolling: boolean; // waiting for check rolls, not for declarations
      declared: number;
      total: number;
      missing: { userId: string; name: string }[];
      deadline: Date;
    };

export type StartSessionResult =
  | { status: 'started'; characters: Character[]; narration: Narration }
  | { status: 'missing-characters'; userIds: string[] };

export interface GameDeps {
  store: CampaignStore;
  generate: Generate;
  rng?: Rng;
  now?: () => Date;
  roundTimeMs?: number;
}

export function createGame({ store, generate, rng = Math.random, now = () => new Date(), roundTimeMs = ROUND_TIME_MS }: GameDeps) {
  /** Calls the LLM with the current context, records its narration and token usage. */
  async function narrate(campaign: Campaign, instruction?: string): Promise<{ campaign: Campaign; narration: Narration }> {
    const { text, usage } = await generate(buildContext(campaign, instruction));
    let updated = appendHistory(campaign, { role: 'gm', text });
    updated = recordUsage(updated, usage);
    // History keeps the raw text (with the closing lines) so the GM keeps seeing its own format.
    const { narration, calls } = parseCallsToAction(text, charactersAtTable(updated));
    const checks = calls.flatMap((call) => (call.kind === 'check' ? [call] : []));
    const deadline = checks.length ? newDeadline() : undefined;
    updated = checks.reduce(
      (current, { userId, attribute, difficulty, goal }) =>
        setPendingCheck(current, userId, { attribute, difficulty, ...(goal ? { goal } : {}) }),
      setRoundDeadline(updated, deadline?.toISOString()),
    );
    return { campaign: updated, narration: { text: narration, calls, ...(deadline ? { deadline } : {}) } };
  }

  function newDeadline(): Date {
    return new Date(now().getTime() + roundTimeMs);
  }

  /**
   * After anything a player does: the GM answers once nobody is left to wait for. Pending checks are
   * waited for first; their results are then narrated together. `force` stops waiting right away.
   */
  async function advance(campaign: Campaign, force = false): Promise<{ campaign: Campaign; result: RoundProgress }> {
    const deadline = roundDeadline(campaign);
    const stopWaiting = force || (deadline !== undefined && now() >= new Date(deadline));
    const current = stopWaiting ? dropPendingChecks(campaign) : campaign;

    const rolling = Object.keys(pendingChecks(current));
    const missing = rolling.length ? rolling : undeclared(current);
    if (rolling.length || (missing.length && !stopWaiting && !hasResultsToNarrate(current))) {
      const session = currentSession(current)!;
      return {
        campaign: current,
        result: {
          status: 'waiting',
          rolling: rolling.length > 0,
          declared: session.participants.length - undeclared(current).length,
          total: session.participants.length,
          missing: missing.map((userId) => ({ userId, name: current.characters[userId]?.name ?? 'Jogador' })),
          deadline: new Date(roundDeadline(current) ?? newDeadline()),
        },
      };
    }
    const { campaign: updated, narration } = await narrate(flushRound(current, now()));
    return { campaign: updated, result: { status: 'narrated', narration } };
  }

  /** Whoever did not roll in time does not act: the code never rolls for a player. */
  function dropPendingChecks(campaign: Campaign): Campaign {
    return Object.entries(pendingChecks(campaign)).reduce(
      (current, [userId, check]) =>
        appendHistory(
          clearPendingCheck(current, userId),
          { role: 'player', userId, text: `(hesitou e não fez o teste de ${ATTRIBUTE_LABELS[check.attribute]})` },
          now(),
        ),
      campaign,
    );
  }

  /** Records a declaration in the open round and answers if the round is complete. */
  function declareAndAdvance(campaign: Campaign, entry: RoundEntry) {
    return advance(declare(campaign, entry, newDeadline().toISOString()));
  }

  /**
   * Runs `play` on the channel's campaign, requiring an ongoing session and the player's character.
   * A player who was not at the table when the session started joins it here.
   */
  async function withPlayer<T>(
    channelId: string,
    userId: string,
    play: (campaign: Campaign) => Promise<{ campaign: Campaign; result: T }>,
  ): Promise<T> {
    let result!: T;
    await store.update(channelId, async (current) => {
      const campaign = requireCampaign(current);
      requireSession(campaign);
      if (!campaign.characters[userId]) {
        throw new GameError('Você ainda não tem personagem. Use /personagem criar.');
      }
      const outcome = await play(addParticipant(campaign, userId));
      result = outcome.result;
      return outcome.campaign;
    });
    return result;
  }

  return {
    /** Creates the campaign and its GM secrets. The first scene only opens on startSession. */
    async newCampaign(channelId: string, input: { setting: string; tone: string; hook: string }): Promise<void> {
      await store.update(channelId, async (current) => {
        if (current) {
          throw new GameError('Este canal já tem uma campanha.');
        }
        const secrets = await generate({
          system: SECRETS_PROMPT,
          messages: [
            { role: 'user', content: `Cenário: ${input.setting}\nTom: ${input.tone}\nGancho: ${input.hook}` },
          ],
        });
        return recordSetupUsage(setSecrets(createCampaign(channelId, input), secrets.text), secrets.usage);
      });
    },

    /** What players may see about the channel's campaign (no GM secrets), or null if there is none. */
    async getStatus(channelId: string): Promise<CampaignStatus | null> {
      const campaign = await store.load(channelId);
      return campaign ? campaignStatus(campaign) : null;
    },

    /** Status of every active campaign. */
    async listCampaigns(): Promise<CampaignStatus[]> {
      return (await store.list()).map(campaignStatus);
    },

    /** Archives the channel's campaign so a new one can start. An ongoing session is archived as is. */
    async endCampaign(channelId: string): Promise<void> {
      if (!(await store.archive(channelId))) {
        throw new GameError('Este canal não tem campanha para encerrar.');
      }
    },

    async createCharacter(
      channelId: string,
      userId: string,
      input: { name: string; concept: string; profile: { strong: Attribute; good: Attribute; weak: Attribute } },
    ): Promise<Character> {
      let attributes: Attributes;
      try {
        attributes = buildAttributes(input.profile);
      } catch (error) {
        throw new GameError((error as Error).message);
      }
      const character: Character = { userId, name: input.name, concept: input.concept, attributes };
      await store.update(channelId, (current) => setCharacter(requireCampaign(current), character));
      return character;
    },

    async getCharacter(channelId: string, userId: string): Promise<Character | null> {
      const campaign = await store.load(channelId);
      return campaign?.characters[userId] ?? null;
    },

    playerAction(channelId: string, userId: string, text: string): Promise<RoundProgress> {
      return withPlayer(channelId, userId, (campaign) => {
        if (pendingChecks(campaign)[userId]) {
          throw new GameError('Role o seu teste antes de declarar outra ação.');
        }
        return declareAndAdvance(campaign, { userId, role: 'player', text });
      });
    },

    playerRoll(channelId: string, userId: string, expression: string): Promise<{ roll: RollResult; progress: RoundProgress }> {
      return withPlayer(channelId, userId, async (campaign) => {
        let roll: RollResult;
        try {
          roll = rollDice(expression, rng);
        } catch (error) {
          throw new GameError((error as Error).message);
        }
        const { campaign: updated, result } = await declareAndAdvance(campaign, { userId, role: 'roll', text: describeRoll(roll) });
        return { campaign: updated, result: { roll, progress: result } };
      });
    },

    /**
     * Starts a session with the players at the table. If any of them has no character yet,
     * nothing changes and their userIds are returned so they can create one first.
     */
    /** Check asked for by the GM: the code rolls 1d20 + attribute, compares and grades; the GM narrates the verdict. */
    playerCheck(
      channelId: string,
      userId: string,
      attribute: Attribute,
      difficulty: number,
    ): Promise<{ check: CheckResult; progress: RoundProgress }> {
      return withPlayer(channelId, userId, async (campaign) => {
        // Buttons outlive their check (repeated requests, old messages): only the pending one rolls.
        const pending = pendingChecks(campaign)[userId];
        if (pending?.attribute !== attribute || pending.difficulty !== difficulty) {
          throw new GameError('Este teste já foi resolvido ou não vale mais.');
        }
        const modifier = characterAttributes(campaign.characters[userId]!)[attribute];
        const check = rollCheck(attribute, modifier, difficulty, rng);
        const withCheck = appendHistory(clearPendingCheck(campaign, userId), { role: 'check', userId, text: describeCheck(check) }, now());
        const { campaign: updated, result } = await advance(withCheck);
        return { campaign: updated, result: { check, progress: result } };
      });
    },

    /** "Resolver agora": any player at the table can stop waiting for the others. */
    async resolveRound(channelId: string, userId: string): Promise<Narration> {
      let narration!: Narration;
      await store.update(channelId, async (current) => {
        const campaign = requireCampaign(current);
        const session = requireSession(campaign);
        if (!session.participants.includes(userId)) {
          throw new GameError('Só quem está na mesa pode resolver a rodada.');
        }
        if (!hasOpenRound(campaign)) {
          throw new GameError('Não há rodada aberta para resolver.');
        }
        const { campaign: updated, result } = await advance(campaign, true);
        if (result.status !== 'narrated') throw new Error('A forced round must be narrated.');
        narration = result.narration;
        return updated;
      });
      return narration;
    },

    /** Called by a timer: closes the round if its deadline has passed. Null when there is nothing to do. */
    async expireRound(channelId: string): Promise<Narration | null> {
      const isDue = (campaign: Campaign | null): campaign is Campaign => {
        const deadline = campaign && currentSession(campaign) ? roundDeadline(campaign) : undefined;
        return deadline !== undefined && now() >= new Date(deadline) && hasOpenRound(campaign!);
      };
      if (!isDue(await store.load(channelId))) return null;

      let narration: Narration | null = null;
      await store.update(channelId, async (current) => {
        const campaign = requireCampaign(current);
        if (!isDue(campaign)) return campaign; // someone closed it while this call waited in the queue
        const { campaign: updated, result } = await advance(campaign);
        if (result.status === 'narrated') narration = result.narration;
        return updated;
      });
      return narration;
    },

    async startSession(channelId: string, playerIds: string[]): Promise<StartSessionResult> {
      let result!: StartSessionResult;
      await store.update(channelId, async (current) => {
        const campaign = requireCampaign(current);
        if (currentSession(campaign)) {
          throw new GameError('Já existe uma sessão em andamento. Use /sessao encerrar antes.');
        }
        if (playerIds.length === 0) {
          throw new GameError('Não há ninguém na mesa.');
        }
        const missing = playerIds.filter((id) => !campaign.characters[id]);
        if (missing.length) {
          result = { status: 'missing-characters', userIds: missing };
          return campaign;
        }

        const isFirstSession = campaign.sessions.length === 0;
        const { campaign: updated, narration } = await narrate(
          startSession(campaign, playerIds),
          isFirstSession ? OPEN_SCENE_INSTRUCTION : RESUME_SESSION_INSTRUCTION,
        );
        const characters = playerIds.map((id) => campaign.characters[id]!);
        result = { status: 'started', characters, narration };
        return updated;
      });
      return result;
    },

    async endSession(channelId: string): Promise<{ summary: string; usage: TokenUsage }> {
      let result!: { summary: string; usage: TokenUsage };
      await store.update(channelId, async (current) => {
        const campaign = requireCampaign(current);
        requireSession(campaign);

        const flushed = flushRound(campaign, now()); // what was declared and never answered still happened at the table
        const previous = lastSummary(flushed);
        const transcript = sessionHistory(flushed).map((entry) => formatEntry(flushed, entry)).join('\n\n');
        const { text: summary, usage } = await generate({
          system: SUMMARY_PROMPT,
          messages: [
            {
              role: 'user',
              content: `${previous ? `Resumo da sessão anterior:\n${previous}\n\n` : ''}Sessão de hoje:\n${transcript || '(nada aconteceu)'}`,
            },
          ],
        });

        const ended = endSession(recordUsage(flushed, usage), summary);
        result = { summary, usage: ended.sessions.at(-1)!.usage };
        return ended;
      });
      return result;
    },
  };
}

export type Game = ReturnType<typeof createGame>;

/** There is something for the GM to answer, or someone it is waiting for. */
function hasOpenRound(campaign: Campaign): boolean {
  return roundEntries(campaign).length > 0 || Object.keys(pendingChecks(campaign)).length > 0 || hasResultsToNarrate(campaign);
}

/** The last thing in the history is not the GM's: check results (or missed checks) await narration. */
function hasResultsToNarrate(campaign: Campaign): boolean {
  const last = campaign.history.at(-1);
  return last !== undefined && last.role !== 'gm';
}

function requireCampaign(campaign: Campaign | null): Campaign {
  if (!campaign) {
    throw new GameError('Este canal ainda não tem campanha. Use /campanha nova.');
  }
  return campaign;
}

function requireSession(campaign: Campaign) {
  const session = currentSession(campaign);
  if (!session) {
    throw new GameError('Não há sessão em andamento. Use /sessao iniciar.');
  }
  return session;
}

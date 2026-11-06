import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GenerateInput } from '../llm/client.ts';
import { OPEN_SCENE_INSTRUCTION, RESUME_SESSION_INSTRUCTION } from '../llm/prompts.ts';
import { currentSession, pendingChecks, roundEntries, setPendingCheck } from '../state/campaign.ts';
import { JsonCampaignStore } from '../state/store.ts';
import { GameError, createGame, type Generate, type RoundProgress } from './game.ts';

const CHANNEL = '100';
const SETUP = { setting: 'Vila costeira', tone: 'mistério', hook: 'Navio vazio' };
const PROFILE = { strong: 'agilidade', good: 'mente', weak: 'presenca' } as const;

/** Fake LLM: records every call and answers with a numbered reply costing 10 in / 5 out tokens. */
function fakeLlm() {
  const calls: GenerateInput[] = [];
  const generate: Generate = async (input) => {
    calls.push(input);
    return { text: `resposta ${calls.length}`, usage: { inputTokens: 10, outputTokens: 5 } };
  };
  return { calls, generate };
}

type Ctx = { game: ReturnType<typeof createGame>; store: JsonCampaignStore; llm: ReturnType<typeof fakeLlm> };

async function withGame(fn: (ctx: Ctx) => Promise<void>, generate?: Generate) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rpg-bot-game-'));
  try {
    const store = new JsonCampaignStore(dir);
    const llm = fakeLlm();
    const game = createGame({ store, generate: generate ?? llm.generate, rng: () => 0.5 });
    await fn({ game, store, llm });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Campaign with Lia (u1) created and session 1 started with her at the table. */
async function playing({ game }: Ctx) {
  await game.newCampaign(CHANNEL, SETUP);
  await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora', profile: PROFILE });
  await game.startSession(CHANNEL, ['u1']);
}

test('newCampaign only generates secrets: no scene, no session', () =>
  withGame(async ({ game, store, llm }) => {
    await game.newCampaign(CHANNEL, SETUP);
    assert.equal(llm.calls.length, 1);

    const campaign = (await store.load(CHANNEL))!;
    assert.equal(campaign.secrets, 'resposta 1');
    assert.equal(currentSession(campaign), undefined);
    assert.deepEqual(campaign.setupUsage, { inputTokens: 10, outputTokens: 5, calls: 1 });
    await assert.rejects(game.newCampaign(CHANNEL, SETUP), GameError);
  }));

test('startSession waits until everyone at the table has a character', () =>
  withGame(async ({ game, store, llm }) => {
    await game.newCampaign(CHANNEL, SETUP);
    await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora', profile: PROFILE });

    const blocked = await game.startSession(CHANNEL, ['u1', 'u2']);
    assert.deepEqual(blocked, { status: 'missing-characters', userIds: ['u2'] });
    assert.equal(currentSession((await store.load(CHANNEL))!), undefined);
    assert.equal(llm.calls.length, 1); // only the secrets call

    await game.createCharacter(CHANNEL, 'u2', { name: 'Tomás', concept: 'padre', profile: PROFILE });
    const started = await game.startSession(CHANNEL, ['u1', 'u2']);
    assert.equal(started.status, 'started');
    assert.equal(llm.calls.at(-1)!.messages.at(-1)?.content, OPEN_SCENE_INSTRUCTION);
    assert.match(llm.calls.at(-1)!.system, /Segredos do mestre[\s\S]*resposta 1/);
  }));

test('startSession rejects an empty table', () =>
  withGame(async ({ game }) => {
    await game.newCampaign(CHANNEL, SETUP);
    await assert.rejects(game.startSession(CHANNEL, []), GameError);
  }));

test('player actions require a campaign, a session and a character', () =>
  withGame(async (ctx) => {
    const { game } = ctx;
    await assert.rejects(game.playerAction(CHANNEL, 'u1', 'olho em volta'), /\/campanha nova/);
    await game.newCampaign(CHANNEL, SETUP);
    await assert.rejects(game.playerAction(CHANNEL, 'u1', 'olho em volta'), /\/sessao iniciar/);
    await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora', profile: PROFILE });
    await game.startSession(CHANNEL, ['u1']);
    await assert.rejects(game.playerAction(CHANNEL, 'u2', 'olho em volta'), /\/personagem criar/);
  }));

test('playerAction records the action and the narration', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    const progress = await ctx.game.playerAction(CHANNEL, 'u1', 'subo a bordo');

    assert.deepEqual(progress, { status: 'narrated', narration: { text: 'resposta 3', calls: [] } });
    assert.equal(ctx.llm.calls[2]!.messages.at(-1)?.content, 'Lia: subo a bordo');
    const history = (await ctx.store.load(CHANNEL))!.history;
    assert.deepEqual(history.slice(-2).map((h) => h.text), ['subo a bordo', 'resposta 3']);
  }));

test('a late player joins the table on their first action', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    await ctx.game.createCharacter(CHANNEL, 'u2', { name: 'Tomás', concept: 'padre', profile: PROFILE });
    await ctx.game.playerAction(CHANNEL, 'u2', 'entro correndo');

    assert.deepEqual(currentSession((await ctx.store.load(CHANNEL))!)?.participants, ['u1', 'u2']);
    await ctx.game.playerAction(CHANNEL, 'u1', 'olho para ele');
    assert.match(ctx.llm.calls.at(-1)!.system, /Personagens na mesa: Lia[^\n]*Tomás/);
  }));

test('playerRoll rolls in code and the GM sees the result', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    const { roll } = await ctx.game.playerRoll(CHANNEL, 'u1', '1d20+2');

    assert.equal(roll.total, 13); // rng 0.5 → 11, +2
    assert.equal(ctx.llm.calls.at(-1)!.messages.at(-1)?.content, 'Lia rolou 1d20+2 = 13 (11 + 2)');
    await assert.rejects(ctx.game.playerRoll(CHANNEL, 'u1', 'abc'), GameError);
  }));

test('nothing is saved when the LLM fails', () => {
  let fail = false;
  const llm = fakeLlm();
  const generate: Generate = async (input) => {
    if (fail) throw new Error('API fora do ar');
    return llm.generate(input);
  };
  return withGame(async (ctx) => {
    await playing(ctx);
    const before = await ctx.store.load(CHANNEL);

    fail = true;
    await assert.rejects(ctx.game.playerAction(CHANNEL, 'u1', 'subo a bordo'), /API fora do ar/);
    assert.deepEqual(await ctx.store.load(CHANNEL), before);
  }, generate);
});

test('session lifecycle: end with summary and usage, then resume', () =>
  withGame(async (ctx) => {
    const { game, store, llm } = ctx;
    await playing(ctx);
    await game.playerAction(CHANNEL, 'u1', 'subo a bordo');

    const { summary, usage } = await game.endSession(CHANNEL);
    assert.equal(summary, 'resposta 4');
    // Session usage excludes the secrets call (setup): opening + action + summary.
    assert.deepEqual(usage, { inputTokens: 30, outputTokens: 15, calls: 3 });
    assert.match(String(llm.calls[3]!.messages[0]!.content), /Lia: subo a bordo/);
    await assert.rejects(game.playerAction(CHANNEL, 'u1', 'x'), /\/sessao iniciar/);

    await game.startSession(CHANNEL, ['u1']);
    assert.equal(llm.calls[4]!.messages.at(-1)?.content, RESUME_SESSION_INSTRUCTION);
    assert.match(llm.calls[4]!.system, /Resumo da sessão anterior:\nresposta 4/);
    assert.equal(currentSession((await store.load(CHANNEL))!)?.number, 2);
    await assert.rejects(game.startSession(CHANNEL, ['u1']), GameError);
  }));

test('endCampaign archives the campaign and frees the channel', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    await ctx.game.endCampaign(CHANNEL);
    assert.equal(await ctx.game.getStatus(CHANNEL), null);
    await assert.rejects(ctx.game.endCampaign(CHANNEL), GameError);
    await ctx.game.newCampaign(CHANNEL, SETUP); // channel is free again
  }));

test('the closing call to action is split from the narration', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    const llm: Generate = async () => ({
      text: 'A corda range.\n\n🎲 Lia, teste de Agilidade para subir (dificuldade 15)',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const game = createGame({ store: ctx.store, generate: llm });
    const progress = await game.playerAction(CHANNEL, 'u1', 'subo no mastro');
    assert.equal(progress.status, 'narrated');
    const { narration } = progress as Extract<RoundProgress, { status: 'narrated' }>;
    assert.equal(narration.text, 'A corda range.');
    assert.deepEqual(narration.calls, [
      {
        kind: 'check',
        userId: 'u1',
        characterName: 'Lia',
        attribute: 'agilidade',
        modifier: 2,
        difficulty: 15,
        goal: 'subir',
      },
    ]);
    // History keeps the raw text so the GM keeps seeing its own format.
    assert.match((await ctx.store.load(CHANNEL))!.history.at(-1)!.text, /🎲 Lia, teste de Agilidade/);
  }));

test('playerCheck rolls 1d20 + attribute in code and gives the GM the verdict', () =>
  withGame(async (ctx) => {
    await playing(ctx); // rng 0.5 → d20 lands on 11; Lia has Agilidade +2
    await ctx.store.update(CHANNEL, (c) => setPendingCheck(c!, 'u1', { attribute: 'agilidade', difficulty: 15 }));
    const { check } = await ctx.game.playerCheck(CHANNEL, 'u1', 'agilidade', 15);
    assert.deepEqual(check, {
      attribute: 'agilidade',
      die: 11,
      modifier: 2,
      total: 13,
      difficulty: 15,
      margin: -2,
      grade: 'close',
    });
    assert.equal(
      ctx.llm.calls.at(-1)!.messages.at(-1)?.content,
      'Lia fez teste de Agilidade: 1d20 (11) +2 = 13 contra dificuldade 15 → Por pouco, faltaram 2 (consegue, mas com um custo ou complicação)',
    );
  }));

/** Fake LLM that gives each scripted line in turn, then plain narration. */
const scripted = (...lines: string[]): Generate => {
  const queue = [...lines];
  return async () => ({ text: `Cena.\n\n${queue.shift() ?? 'Fim.'}`, usage: { inputTokens: 1, outputTokens: 1 } });
};
const ASK_CHECK = '🎲 Lia, teste de Agilidade para subir (dificuldade 15)';

test('a requested check rolls only once', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    const game = createGame({ store: ctx.store, generate: scripted(ASK_CHECK), rng: () => 0.5 });
    await game.playerAction(CHANNEL, 'u1', 'subo no mastro');
    assert.deepEqual(pendingChecks((await ctx.store.load(CHANNEL))!), {
      u1: { attribute: 'agilidade', difficulty: 15, goal: 'subir' },
    });

    await game.playerCheck(CHANNEL, 'u1', 'agilidade', 15);
    assert.deepEqual(pendingChecks((await ctx.store.load(CHANNEL))!), {});

    await assert.rejects(game.playerCheck(CHANNEL, 'u1', 'agilidade', 15), GameError);
    const { history } = (await ctx.store.load(CHANNEL))!;
    assert.equal(history.filter((entry) => entry.role === 'check').length, 1);
  }));

test('a check that is not the pending one cannot be rolled', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    await assert.rejects(ctx.game.playerCheck(CHANNEL, 'u1', 'agilidade', 15), GameError);

    const game = createGame({ store: ctx.store, generate: scripted(ASK_CHECK), rng: () => 0.5 });
    await game.playerAction(CHANNEL, 'u1', 'subo no mastro');
    await assert.rejects(game.playerCheck(CHANNEL, 'u1', 'agilidade', 10), GameError);
    await assert.rejects(game.playerCheck(CHANNEL, 'u1', 'mente', 15), GameError);
  }));

const ASK_BOTH = '🎲 Lia, teste de Agilidade para subir (dificuldade 10)\n🎲 Tomás, teste de Mente para lembrar (dificuldade 15)';

/** Lia (u1) and Tomás (u2) at the table, with a clock the test controls. */
async function twoPlayers(ctx: Ctx, generate?: Generate) {
  await ctx.game.newCampaign(CHANNEL, SETUP);
  await ctx.game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora', profile: PROFILE });
  await ctx.game.createCharacter(CHANNEL, 'u2', { name: 'Tomás', concept: 'padre', profile: PROFILE });
  await ctx.game.startSession(CHANNEL, ['u1', 'u2']);
  const clock = { time: new Date('2030-01-01T00:00:00Z') };
  const game = createGame({ store: ctx.store, generate: generate ?? ctx.llm.generate, rng: () => 0.5, now: () => clock.time, roundTimeMs: 60_000 });
  const tick = (ms: number) => {
    clock.time = new Date(clock.time.getTime() + ms);
  };
  return { game, tick };
}

const callsSoFar = (ctx: Ctx) => ctx.llm.calls.length;

test('the GM answers once, after everyone at the table has declared', () =>
  withGame(async (ctx) => {
    const { game } = await twoPlayers(ctx);
    const before = callsSoFar(ctx);

    const first = await game.playerAction(CHANNEL, 'u1', 'abro a porta');
    assert.equal(first.status, 'waiting');
    assert.deepEqual(first.status === 'waiting' && [first.declared, first.total, first.missing], [1, 2, [{ userId: 'u2', name: 'Tomás' }]]);
    assert.equal(callsSoFar(ctx), before);

    const second = await game.playerAction(CHANNEL, 'u2', 'rezo');
    assert.equal(second.status, 'narrated');
    assert.equal(callsSoFar(ctx), before + 1);
    assert.deepEqual(ctx.llm.calls.at(-1)!.messages.slice(-2).map((m) => m.content), ['Lia: abro a porta', 'Tomás: rezo']);
    assert.deepEqual(roundEntries((await ctx.store.load(CHANNEL))!), []);
  }));

test('declaring again before the round closes replaces the action', () =>
  withGame(async (ctx) => {
    const { game } = await twoPlayers(ctx);
    await game.playerAction(CHANNEL, 'u1', 'abro a porta');
    await game.playerAction(CHANNEL, 'u1', 'fecho a porta');
    await game.playerAction(CHANNEL, 'u2', 'rezo');
    assert.deepEqual(ctx.llm.calls.at(-1)!.messages.slice(-2).map((m) => m.content), ['Lia: fecho a porta', 'Tomás: rezo']);
  }));

test('resolveRound stops waiting, only for players at the table and only with an open round', () =>
  withGame(async (ctx) => {
    const { game } = await twoPlayers(ctx);
    await assert.rejects(game.resolveRound(CHANNEL, 'u1'), GameError); // nothing declared yet
    await game.playerAction(CHANNEL, 'u1', 'abro a porta');
    await assert.rejects(game.resolveRound(CHANNEL, 'stranger'), /Só quem está na mesa/);

    const narration = await game.resolveRound(CHANNEL, 'u2');
    assert.match(narration.text, /resposta/);
    assert.equal(ctx.llm.calls.at(-1)!.messages.at(-1)?.content, 'Lia: abro a porta');
  }));

test('expireRound closes the round only after the deadline', () =>
  withGame(async (ctx) => {
    const { game, tick } = await twoPlayers(ctx);
    await game.playerAction(CHANNEL, 'u1', 'abro a porta');
    const before = callsSoFar(ctx);

    tick(59_000);
    assert.equal(await game.expireRound(CHANNEL), null);
    assert.equal(callsSoFar(ctx), before);

    tick(1_000);
    assert.notEqual(await game.expireRound(CHANNEL), null);
    assert.equal(callsSoFar(ctx), before + 1);
    assert.equal(await game.expireRound(CHANNEL), null); // already closed
  }));

test('expireRound does nothing without a campaign, a session or a round', () =>
  withGame(async (ctx) => {
    assert.equal(await ctx.game.expireRound(CHANNEL), null);
    await playing(ctx);
    assert.equal(await ctx.game.expireRound(CHANNEL), null);
    await ctx.game.endSession(CHANNEL);
    assert.equal(await ctx.game.expireRound(CHANNEL), null);
  }));

test('a round past its deadline closes on the next action (e.g. the timer was lost in a restart)', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    await ctx.game.createCharacter(CHANNEL, 'u2', { name: 'Tomás', concept: 'padre', profile: PROFILE });
    await ctx.game.createCharacter(CHANNEL, 'u3', { name: 'Rui', concept: 'guarda', profile: PROFILE });
    await ctx.game.endSession(CHANNEL);
    await ctx.game.startSession(CHANNEL, ['u1', 'u2', 'u3']);
    const clock = { time: new Date('2030-01-01T00:00:00Z') };
    const game = createGame({ store: ctx.store, generate: ctx.llm.generate, now: () => clock.time, roundTimeMs: 60_000 });

    assert.equal((await game.playerAction(CHANNEL, 'u1', 'abro')).status, 'waiting');
    clock.time = new Date(clock.time.getTime() + 60_000);
    assert.equal((await game.playerAction(CHANNEL, 'u2', 'rezo')).status, 'narrated');
  }));

test('several checks: results appear as rolled and the GM narrates them together', () =>
  withGame(async (ctx) => {
    let gmCalls = 0;
    const generate: Generate = async () => ({
      text: `Cena.\n\n${gmCalls++ === 0 ? ASK_BOTH : '👉 Todos, o que vocês fazem?'}`,
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { game } = await twoPlayers(ctx, generate);
    await game.playerAction(CHANNEL, 'u1', 'subo');
    const asked = await game.playerAction(CHANNEL, 'u2', 'lembro');
    assert.ok(asked.status === 'narrated' && asked.narration.deadline);
    assert.equal(gmCalls, 1);

    const first = await game.playerCheck(CHANNEL, 'u1', 'agilidade', 10);
    assert.equal(first.check.die, 11);
    assert.deepEqual(first.progress.status === 'waiting' && [first.progress.rolling, first.progress.missing], [true, [{ userId: 'u2', name: 'Tomás' }]]);
    assert.equal(gmCalls, 1);

    const second = await game.playerCheck(CHANNEL, 'u2', 'mente', 15);
    assert.equal(second.progress.status, 'narrated');
    assert.equal(gmCalls, 2);
  }));

test('a player with a pending check must roll before declaring; others may declare early', () =>
  withGame(async (ctx) => {
    const { game } = await twoPlayers(ctx, scripted(ASK_CHECK));
    await game.playerAction(CHANNEL, 'u1', 'subo');
    await game.playerAction(CHANNEL, 'u2', 'rezo'); // the GM asks only Lia for a check

    await assert.rejects(game.playerAction(CHANNEL, 'u1', 'desisto'), /Role o seu teste/);
    assert.equal((await game.playerAction(CHANNEL, 'u2', 'corro atrás dela')).status, 'waiting');
    assert.equal((await game.playerCheck(CHANNEL, 'u1', 'agilidade', 15)).progress.status, 'narrated');
    assert.match(String(JSON.stringify((await ctx.store.load(CHANNEL))!.history.slice(-3))), /corro atrás dela/);
  }));

test('whoever does not roll in time does not act: nobody rolls for them', () =>
  withGame(async (ctx) => {
    const seen: GenerateInput[] = [];
    let gmCalls = 0;
    const generate: Generate = async (input) => {
      seen.push(input);
      return { text: gmCalls++ === 0 ? `Cena.\n\n${ASK_BOTH}` : 'Fim.', usage: { inputTokens: 1, outputTokens: 1 } };
    };
    const { game, tick } = await twoPlayers(ctx, generate);
    await game.playerAction(CHANNEL, 'u1', 'subo');
    await game.playerAction(CHANNEL, 'u2', 'lembro');
    await game.playerCheck(CHANNEL, 'u1', 'agilidade', 10);

    tick(60_000);
    assert.notEqual(await game.expireRound(CHANNEL), null);
    assert.deepEqual(pendingChecks((await ctx.store.load(CHANNEL))!), {});
    assert.equal(seen.at(-1)!.messages.at(-1)?.content, 'Tomás: (hesitou e não fez o teste de Mente)');
    await assert.rejects(game.playerCheck(CHANNEL, 'u2', 'mente', 15), GameError);
  }));

test('a declaration still unanswered goes into the session summary', () =>
  withGame(async (ctx) => {
    const { game } = await twoPlayers(ctx);
    await game.playerAction(CHANNEL, 'u1', 'abro a porta');
    await game.endSession(CHANNEL);
    assert.match(String(ctx.llm.calls.at(-1)!.messages[0]!.content), /Lia: abro a porta/);
  }));

test('getStatus and listCampaigns report active campaigns', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    await ctx.game.newCampaign('200', { setting: 'Deserto', tone: 'aventura', hook: 'Oásis seco' });

    assert.equal((await ctx.game.getStatus(CHANNEL))?.session?.ongoing, true);
    const settings = (await ctx.game.listCampaigns()).map((s) => s.setting).sort();
    assert.deepEqual(settings, ['Deserto', 'Vila costeira']);
  }));

test('createCharacter builds attributes and rejects a repeated pick', () =>
  withGame(async ({ game }) => {
    await game.newCampaign(CHANNEL, SETUP);
    const lia = await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora', profile: PROFILE });
    assert.deepEqual(lia.attributes, { forca: 0, agilidade: 2, mente: 1, presenca: -1 });
    await assert.rejects(
      game.createCharacter(CHANNEL, 'u2', {
        name: 'Tomás',
        concept: 'padre',
        profile: { strong: 'forca', good: 'forca', weak: 'mente' },
      }),
      GameError,
    );
  }));

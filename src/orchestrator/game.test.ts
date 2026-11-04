import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GenerateInput } from '../llm/client.ts';
import { OPEN_SCENE_INSTRUCTION, RESUME_SESSION_INSTRUCTION } from '../llm/prompts.ts';
import { currentSession } from '../state/campaign.ts';
import { JsonCampaignStore } from '../state/store.ts';
import { GameError, createGame, type Generate } from './game.ts';

const CHANNEL = '100';
const SETUP = { setting: 'Vila costeira', tone: 'mistério', hook: 'Navio vazio' };

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
  await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora' });
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
    await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora' });

    const blocked = await game.startSession(CHANNEL, ['u1', 'u2']);
    assert.deepEqual(blocked, { status: 'missing-characters', userIds: ['u2'] });
    assert.equal(currentSession((await store.load(CHANNEL))!), undefined);
    assert.equal(llm.calls.length, 1); // only the secrets call

    await game.createCharacter(CHANNEL, 'u2', { name: 'Tomás', concept: 'padre' });
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
    await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora' });
    await game.startSession(CHANNEL, ['u1']);
    await assert.rejects(game.playerAction(CHANNEL, 'u2', 'olho em volta'), /\/personagem criar/);
  }));

test('playerAction records the action and the narration', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    const narration = await ctx.game.playerAction(CHANNEL, 'u1', 'subo a bordo');

    assert.equal(narration, 'resposta 3');
    assert.equal(ctx.llm.calls[2]!.messages.at(-1)?.content, 'Lia: subo a bordo');
    const history = (await ctx.store.load(CHANNEL))!.history;
    assert.deepEqual(history.slice(-2).map((h) => h.text), ['subo a bordo', 'resposta 3']);
  }));

test('a late player joins the table on their first action', () =>
  withGame(async (ctx) => {
    await playing(ctx);
    await ctx.game.createCharacter(CHANNEL, 'u2', { name: 'Tomás', concept: 'padre' });
    await ctx.game.playerAction(CHANNEL, 'u2', 'entro correndo');

    assert.deepEqual(currentSession((await ctx.store.load(CHANNEL))!)?.participants, ['u1', 'u2']);
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
    assert.equal(await ctx.game.getCampaign(CHANNEL), null);
    await assert.rejects(ctx.game.endCampaign(CHANNEL), GameError);
    await ctx.game.newCampaign(CHANNEL, SETUP); // channel is free again
  }));

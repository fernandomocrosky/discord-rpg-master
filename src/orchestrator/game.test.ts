import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GenerateInput } from '../llm/client.ts';
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

async function withGame(fn: (ctx: { game: ReturnType<typeof createGame>; store: JsonCampaignStore; llm: ReturnType<typeof fakeLlm> }) => Promise<void>, generate?: Generate) {
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

test('newCampaign generates secrets, then opens the scene', () =>
  withGame(async ({ game, store, llm }) => {
    const narration = await game.newCampaign(CHANNEL, SETUP);
    assert.equal(narration, 'resposta 2');
    assert.equal(llm.calls.length, 2);
    assert.match(llm.calls[1]!.system, /Segredos do mestre[\s\S]*resposta 1/);

    const campaign = (await store.load(CHANNEL))!;
    assert.equal(campaign.secrets, 'resposta 1');
    assert.deepEqual(currentSession(campaign)?.usage, { inputTokens: 20, outputTokens: 10, calls: 2 });
    await assert.rejects(game.newCampaign(CHANNEL, SETUP), GameError);
  }));

test('player actions require a campaign and a character', () =>
  withGame(async ({ game }) => {
    await assert.rejects(game.playerAction(CHANNEL, 'u1', 'olho em volta'), /\/campanha nova/);
    await game.newCampaign(CHANNEL, SETUP);
    await assert.rejects(game.playerAction(CHANNEL, 'u1', 'olho em volta'), /\/personagem criar/);
  }));

test('playerAction records the action and the narration', () =>
  withGame(async ({ game, store, llm }) => {
    await game.newCampaign(CHANNEL, SETUP);
    await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora' });
    const narration = await game.playerAction(CHANNEL, 'u1', 'subo a bordo');

    assert.equal(narration, 'resposta 3');
    assert.equal(llm.calls[2]!.messages.at(-1)?.content, 'Lia: subo a bordo');
    const history = (await store.load(CHANNEL))!.history;
    assert.deepEqual(history.slice(-2).map((h) => h.text), ['subo a bordo', 'resposta 3']);
  }));

test('playerRoll rolls in code and the GM sees the result', () =>
  withGame(async ({ game, llm }) => {
    await game.newCampaign(CHANNEL, SETUP);
    await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora' });
    const { roll } = await game.playerRoll(CHANNEL, 'u1', '1d20+2');

    assert.equal(roll.total, 13); // rng 0.5 → 11, +2
    assert.equal(llm.calls.at(-1)!.messages.at(-1)?.content, 'Lia rolou 1d20+2 = 13 (11 + 2)');
    await assert.rejects(game.playerRoll(CHANNEL, 'u1', 'abc'), GameError);
  }));

test('nothing is saved when the LLM fails', () => {
  let fail = false;
  const llm = fakeLlm();
  const generate: Generate = async (input) => {
    if (fail) throw new Error('API fora do ar');
    return llm.generate(input);
  };
  return withGame(async ({ game, store }) => {
    await game.newCampaign(CHANNEL, SETUP);
    await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora' });
    const before = await store.load(CHANNEL);

    fail = true;
    await assert.rejects(game.playerAction(CHANNEL, 'u1', 'subo a bordo'), /API fora do ar/);
    assert.deepEqual(await store.load(CHANNEL), before);
  }, generate);
});

test('session lifecycle: end with summary and usage, then resume', () =>
  withGame(async ({ game, store, llm }) => {
    await game.newCampaign(CHANNEL, SETUP);
    await game.createCharacter(CHANNEL, 'u1', { name: 'Lia', concept: 'pescadora' });
    await game.playerAction(CHANNEL, 'u1', 'subo a bordo');

    const { summary, usage } = await game.endSession(CHANNEL);
    assert.equal(summary, 'resposta 4');
    assert.deepEqual(usage, { inputTokens: 40, outputTokens: 20, calls: 4 });
    assert.match(String(llm.calls[3]!.messages[0]!.content), /Lia: subo a bordo/);
    await assert.rejects(game.playerAction(CHANNEL, 'u1', 'x'), /\/sessao iniciar/);

    await game.startSession(CHANNEL);
    assert.match(llm.calls[4]!.system, /Resumo da sessão anterior:\nresposta 4/);
    assert.equal(currentSession((await store.load(CHANNEL))!)?.number, 2);
    await assert.rejects(game.startSession(CHANNEL), GameError);
  }));

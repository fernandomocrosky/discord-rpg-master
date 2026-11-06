import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Generate } from '../orchestrator/game.ts';
import { GM_SYSTEM_PROMPT } from '../llm/prompts.ts';
import { JsonCampaignStore } from '../state/store.ts';
import { SCENARIOS } from './scenarios.ts';
import { seededRng, simulate } from './simulate.ts';

const scenario = SCENARIOS[0]!;

/** Fake LLM: the GM alternates turns and checks; players and setup get plain text. */
function fakeLlm() {
  const systems: string[] = [];
  let gmCalls = 0;
  const generate: Generate = async ({ system }) => {
    systems.push(system);
    const usage = { inputTokens: 100, outputTokens: 10 };
    if (!system.startsWith(GM_SYSTEM_PROMPT.slice(0, 40))) return { text: 'tento algo', usage };
    gmCalls++;
    const name = scenario.players[gmCalls % scenario.players.length]!.name;
    return {
      text: gmCalls % 2 ? `Cena.\n\n👉 ${name}, o que você faz?` : `Cena.\n\n🎲 ${name}, teste de Mente para pensar (dificuldade 10)`,
      usage,
    };
  };
  return { generate, systems };
}

async function run(maxResponses: number, budgetTokens: number) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rpg-bot-sim-test-'));
  try {
    const llm = fakeLlm();
    const result = await simulate({
      scenario,
      store: new JsonCampaignStore(dir),
      generate: llm.generate,
      rng: seededRng(1),
      maxResponses,
      budgetTokens,
    });
    return { result, systems: llm.systems };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('plays until the response limit and ends the session', async () => {
  const { result } = await run(8, 1_000_000);
  assert.equal(result.stopReason, 'responses');
  assert.equal(result.events.filter((e) => e.kind === 'gm').length, 8);
  assert.ok(result.events.some((e) => e.kind === 'action'));
  assert.ok(result.events.some((e) => e.kind === 'check'));
  assert.notEqual(result.summary, null);
});

test('stops at the budget and keeps what was played', async () => {
  const { result } = await run(100, 500);
  assert.equal(result.stopReason, 'budget');
  assert.ok(result.gm.inputTokens + result.gm.outputTokens + result.players.inputTokens + result.players.outputTokens >= 500);
  assert.ok(result.events.length > 0);
});

test('simulated players never receive the GM secrets', async () => {
  const { systems } = await run(6, 1_000_000);
  const playerPrompts = systems.filter((s) => s.startsWith('Você é um jogador'));
  assert.ok(playerPrompts.length > 0);
  assert.ok(playerPrompts.every((s) => !s.includes('Segredos do mestre')));
});

test('the same seed gives the same dice and behavior', async () => {
  const kinds = async () => (await run(8, 1_000_000)).result.events.map((e) => e.kind);
  assert.deepEqual(await kinds(), await kinds());
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollCheck } from '../rules/checks.ts';
import { computeMetrics, type SimEvent } from './metrics.ts';

const names = { u1: 'Lia', u2: 'Tomás' };
const turn = (userId: string, prompt: string, text = 'Cena.'): SimEvent => ({
  kind: 'gm',
  rawText: text,
  narration: { text, callToAction: { kind: 'turn', userId, characterName: names[userId as keyof typeof names], prompt } },
});
const action = (userId: string, called = true): SimEvent => ({
  kind: 'action',
  userId,
  name: names[userId as keyof typeof names],
  text: 'ajo',
  called,
});

test('counts calls, actions, streaks and unanswered calls per character', () => {
  const metrics = computeMetrics(
    [turn('u1', 'o que faz?'), action('u2', false), turn('u1', 'o que faz?'), action('u1'), turn('u2', 'e agora?')],
    names,
  );
  assert.equal(metrics.responses, 3);
  assert.deepEqual(metrics.callsByCharacter, { Lia: 2, Tomás: 1 });
  assert.deepEqual(metrics.actionsByCharacter, { Lia: 1, Tomás: 1 });
  assert.equal(metrics.outOfTurnActions, 1);
  assert.equal(metrics.unansweredCalls, 1);
  assert.deepEqual(metrics.longestCallStreak, { name: 'Lia', length: 2 });
});

test('flags option menus and "você" in the narration', () => {
  const metrics = computeMetrics([turn('u1', 'você foge ou luta?', 'Você vê a porta.'), turn('u2', 'o que faz?')], names);
  assert.equal(metrics.menuQuestions, 1);
  assert.equal(metrics.narrationsWithYou, 1);
});

test('flags a missing closing line and a difficulty the code read wrong', () => {
  const metrics = computeMetrics(
    [
      { kind: 'gm', rawText: 'Cena.', narration: { text: 'Cena.', callToAction: null } },
      {
        kind: 'gm',
        rawText: '🎲 Lia, teste de Mente (dificuldade 20)',
        narration: {
          text: '',
          callToAction: { kind: 'check', userId: 'u1', characterName: 'Lia', attribute: 'mente', modifier: 0, difficulty: 15 },
        },
      },
    ],
    names,
  );
  assert.equal(metrics.missingCallToAction, 1);
  assert.equal(metrics.difficultyMismatches, 1);
  assert.deepEqual(metrics.difficulties, { 15: 1 });
});

test('counts check grades', () => {
  const check = rollCheck('mente', 0, 10, () => 0.5);
  const metrics = computeMetrics([{ kind: 'check', userId: 'u1', name: 'Lia', check }], names);
  assert.deepEqual(metrics.checksByCharacter, { Lia: 1, Tomás: 0 });
  assert.deepEqual(metrics.grades, { success: 1 });
});

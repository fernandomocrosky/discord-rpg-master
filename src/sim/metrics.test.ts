import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollCheck } from '../rules/checks.ts';
import { computeMetrics, type SimEvent } from './metrics.ts';

const names = { u1: 'Lia', u2: 'Tomás' };
const players = [
  { userId: 'u1', characterName: 'Lia' },
  { userId: 'u2', characterName: 'Tomás' },
];
const gm = (text: string, prompt: string): SimEvent => ({
  kind: 'gm',
  rawText: text,
  narration: { text, calls: [{ kind: 'group', players, prompt }] },
});
const action = (userId: 'u1' | 'u2'): SimEvent => ({ kind: 'action', userId, name: names[userId], text: 'ajo' });

test('counts actions, silences, forced rounds and group calls', () => {
  const metrics = computeMetrics(
    [
      gm('Cena.', 'o que fazem?'),
      action('u1'),
      { kind: 'silence', userId: 'u2', name: 'Tomás' },
      { kind: 'round-closed' },
      gm('Lia abre.', 'e agora?'),
    ],
    names,
  );
  assert.equal(metrics.responses, 2);
  assert.deepEqual(metrics.actionsByCharacter, { Lia: 1, Tomás: 0 });
  assert.equal(metrics.silences, 1);
  assert.equal(metrics.forcedRounds, 1);
  assert.equal(metrics.groupCalls, 2);
});

test('flags an action the GM answer does not mention', () => {
  const metrics = computeMetrics([action('u1'), action('u2'), gm('Lia abre a porta.', 'o que fazem?')], names);
  assert.equal(metrics.ignoredActions, 1);
});

test('flags option menus and "você" in the narration', () => {
  const metrics = computeMetrics([gm('Você vê a porta.', 'vocês fogem ou lutam?'), gm('Cena.', 'o que fazem?')], names);
  assert.equal(metrics.menuQuestions, 1);
  assert.equal(metrics.narrationsWithYou, 1);
});

test('flags missing closing lines and a difficulty the code read wrong, per character', () => {
  const check = (userId: string, characterName: string, difficulty: number) =>
    ({ kind: 'check', userId, characterName, attribute: 'mente', modifier: 0, difficulty }) as const;
  const metrics = computeMetrics(
    [
      { kind: 'gm', rawText: 'Cena.', narration: { text: 'Cena.', calls: [] } },
      {
        kind: 'gm',
        rawText: '🎲 Lia, teste de Mente (dificuldade 20)\n🎲 Tomás, teste de Mente (dificuldade 10)',
        narration: { text: '', calls: [check('u1', 'Lia', 15), check('u2', 'Tomás', 10)] },
      },
    ],
    names,
  );
  assert.equal(metrics.missingCallToAction, 1);
  assert.equal(metrics.difficultyMismatches, 1);
  assert.deepEqual(metrics.difficulties, { 10: 1, 15: 1 });
  assert.deepEqual(metrics.checksAskedByCharacter, { Lia: 1, Tomás: 1 });
});

test('counts rolled and missed checks', () => {
  const check = rollCheck('mente', 0, 10, () => 0.5);
  const metrics = computeMetrics(
    [
      { kind: 'check', userId: 'u1', name: 'Lia', check },
      { kind: 'missed-check', userId: 'u2', name: 'Tomás' },
    ],
    names,
  );
  assert.deepEqual(metrics.checksRolledByCharacter, { Lia: 1, Tomás: 0 });
  assert.deepEqual(metrics.grades, { success: 1 });
  assert.equal(metrics.missedChecks, 1);
});

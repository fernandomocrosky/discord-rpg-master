import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Character } from '../state/campaign.ts';
import { DEFAULT_DIFFICULTY, parseCallToAction } from './call-to-action.ts';

const table: Character[] = [
  { userId: 'u1', name: 'Lia', concept: 'pescadora', attributes: { forca: 0, agilidade: 2, mente: 1, presenca: -1 } },
  { userId: 'u2', name: 'Tomás', concept: 'padre' }, // created before attributes existed
];

test('turn line: removed from the narration and returned', () => {
  const result = parseCallToAction('O pescador recua.\n\n👉 Lia, ele vai fugir. O que você faz?', table);
  assert.equal(result.narration, 'O pescador recua.');
  assert.deepEqual(result.callToAction, {
    kind: 'turn',
    userId: 'u1',
    characterName: 'Lia',
    prompt: 'ele vai fugir. O que você faz?',
  });
});

test('check line: attribute, modifier, goal and difficulty', () => {
  const result = parseCallToAction('A corda range.\n🎲 Lia, teste de Agilidade para escalar o mastro (dificuldade 15)', table);
  assert.equal(result.narration, 'A corda range.');
  assert.deepEqual(result.callToAction, {
    kind: 'check',
    userId: 'u1',
    characterName: 'Lia',
    attribute: 'agilidade',
    modifier: 2,
    difficulty: 15,
    goal: 'escalar o mastro',
  });
});

test('tolerates markdown, case and accents; defaults a missing difficulty; old characters get +0', () => {
  const result = parseCallToAction('**🎲 tomas, teste de forca**', table);
  assert.deepEqual(result.callToAction, {
    kind: 'check',
    userId: 'u2',
    characterName: 'Tomás',
    attribute: 'forca',
    modifier: 0,
    difficulty: DEFAULT_DIFFICULTY,
  });
});

test('unknown character or attribute: text untouched, no call to action', () => {
  for (const line of ['👉 Bruno, sua vez.', '🎲 Lia, teste de Carisma (dificuldade 10)']) {
    const text = `A noite cai.\n${line}`;
    assert.deepEqual(parseCallToAction(text, table), { narration: text, callToAction: null });
  }
});

test('no closing line: narration only', () => {
  assert.deepEqual(parseCallToAction('A noite cai sobre a vila.', table), {
    narration: 'A noite cai sobre a vila.',
    callToAction: null,
  });
});

test('check line: text after the difficulty does not hide it and becomes the stakes', () => {
  const { narration, callToAction } = parseCallToAction(
    'A lança desce.\n\n🎲 Lia, teste de Mente para lançar o sono (dificuldade 20). Se falhar, ela desmaia.',
    table,
  );
  assert.equal(narration, 'A lança desce.');
  assert.deepEqual(callToAction, {
    kind: 'check',
    userId: 'u1',
    characterName: 'Lia',
    attribute: 'mente',
    modifier: 1,
    difficulty: 20,
    goal: 'lançar o sono',
    stakes: 'Se falhar, ela desmaia.',
  });
});

test('check line: a period after the difficulty is not stakes', () => {
  const { callToAction } = parseCallToAction('🎲 Lia, teste de Mente para lembrar (dificuldade 20).', table);
  assert.equal(callToAction?.kind === 'check' && callToAction.difficulty, 20);
  assert.equal(callToAction?.kind === 'check' && callToAction.stakes, undefined);
});

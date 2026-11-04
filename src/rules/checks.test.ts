import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Rng } from './dice.ts';
import { buildAttributes, describeCheck, formatModifier, gradeCheck, parseAttribute, rollCheck } from './checks.ts';

/** RNG that makes the d20 land on `face`. */
const d20 = (face: number): Rng => () => (face - 1) / 20;

test('buildAttributes gives strong +2, good +1, weak -1 and +0 to the rest', () => {
  assert.deepEqual(buildAttributes({ strong: 'agilidade', good: 'mente', weak: 'presenca' }), {
    forca: 0,
    agilidade: 2,
    mente: 1,
    presenca: -1,
  });
});

test('buildAttributes requires three different attributes', () => {
  assert.throws(() => buildAttributes({ strong: 'forca', good: 'forca', weak: 'mente' }), /diferentes/);
});

test('parseAttribute ignores case and accents', () => {
  assert.equal(parseAttribute('Força'), 'forca');
  assert.equal(parseAttribute('forca'), 'forca');
  assert.equal(parseAttribute(' PRESENÇA '), 'presenca');
  assert.equal(parseAttribute('Carisma'), null);
});

test('formatModifier always shows the sign', () => {
  assert.equal(formatModifier(2), '+2');
  assert.equal(formatModifier(0), '+0');
  assert.equal(formatModifier(-1), '-1');
});

test('gradeCheck: natural 20/1 first, then the margin', () => {
  assert.equal(gradeCheck(20, -10), 'critical');
  assert.equal(gradeCheck(1, 10), 'disaster');
  assert.equal(gradeCheck(15, 5), 'full-success');
  assert.equal(gradeCheck(12, 0), 'success');
  assert.equal(gradeCheck(12, 4), 'success');
  assert.equal(gradeCheck(10, -1), 'close');
  assert.equal(gradeCheck(10, -4), 'close');
  assert.equal(gradeCheck(5, -5), 'failure');
});

test('rollCheck adds the modifier and compares with the difficulty', () => {
  assert.deepEqual(rollCheck('agilidade', 2, 15, d20(14)), {
    attribute: 'agilidade',
    die: 14,
    modifier: 2,
    total: 16,
    difficulty: 15,
    margin: 1,
    grade: 'success',
  });
  assert.equal(rollCheck('forca', 5, 10, d20(20)).grade, 'critical');
  assert.equal(rollCheck('forca', 5, 10, d20(1)).grade, 'disaster');
});

test('describeCheck tells the GM the numbers and the verdict', () => {
  assert.equal(
    describeCheck(rollCheck('agilidade', 2, 15, d20(14))),
    'teste de Agilidade: 1d20 (14) +2 = 16 contra dificuldade 15 → Sucesso por 1 (consegue)',
  );
  assert.match(describeCheck(rollCheck('mente', -1, 15, d20(16))), /= 15 contra dificuldade 15 → Sucesso no limite/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRoll, parseDice, rollDice, type Rng } from './dice.ts';

/** RNG that returns the given values in sequence. */
function fixedRng(...values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length]!;
}

test('parseDice accepts common formats', () => {
  assert.deepEqual(parseDice('1d20+3'), { count: 1, sides: 20, modifier: 3 });
  assert.deepEqual(parseDice('2d6'), { count: 2, sides: 6, modifier: 0 });
  assert.deepEqual(parseDice('d8-1'), { count: 1, sides: 8, modifier: -1 });
  assert.deepEqual(parseDice(' 3D10 + 2 '), { count: 3, sides: 10, modifier: 2 });
});

test('parseDice rejects invalid expressions', () => {
  for (const bad of ['', 'abc', '1d', 'd', '2d6+', '1d20+3+1', '0d6', '1d1', '101d6', '1d1001']) {
    assert.throws(() => parseDice(bad), Error, `should reject "${bad}"`);
  }
});

test('rollDice uses the injected RNG and adds the modifier', () => {
  // 0 → 1; 0.999 → 6 on a d6
  const result = rollDice('2d6+1', fixedRng(0, 0.999));
  assert.deepEqual(result.rolls, [1, 6]);
  assert.equal(result.total, 8);
  assert.equal(result.expression, '2d6+1');
});

test('rollDice with a negative modifier', () => {
  const result = rollDice('d8-1', fixedRng(0.5));
  assert.deepEqual(result.rolls, [5]);
  assert.equal(result.total, 4);
  assert.equal(result.expression, '1d8-1');
});

test('rollDice always stays within range', () => {
  for (let i = 0; i < 1000; i++) {
    const { rolls } = rollDice('1d20');
    assert.ok(rolls[0]! >= 1 && rolls[0]! <= 20);
  }
});

test('describeRoll shows dice, modifier and total', () => {
  assert.equal(describeRoll({ expression: '1d20+2', rolls: [15], modifier: 2, total: 17 }), '1d20+2 = 17 (15 + 2)');
  assert.equal(describeRoll({ expression: '2d6', rolls: [3, 4], modifier: 0, total: 7 }), '2d6 = 7 (3, 4)');
  assert.equal(describeRoll({ expression: '1d8-1', rolls: [5], modifier: -1, total: 4 }), '1d8-1 = 4 (5 - 1)');
});

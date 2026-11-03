import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage } from './reply.ts';

test('short text stays in one part', () => {
  assert.deepEqual(splitMessage('olá'), ['olá']);
});

test('splits on paragraph boundaries first', () => {
  const a = 'a'.repeat(15);
  const b = 'b'.repeat(15);
  assert.deepEqual(splitMessage(`${a}\n\n${b}`, 20), [a, b]);
});

test('falls back to words, then to a hard cut', () => {
  assert.deepEqual(splitMessage('um dois tres quatro', 8), ['um dois', 'tres', 'quatro']);
  assert.deepEqual(splitMessage('x'.repeat(25), 10), ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
});

test('every part respects the limit', () => {
  const text = Array.from({ length: 300 }, (_, i) => `Frase número ${i} da narração.`).join(' ');
  for (const part of splitMessage(text)) {
    assert.ok(part.length <= 2000);
  }
});

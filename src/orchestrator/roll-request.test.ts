import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Character } from '../state/campaign.ts';
import { parseRollRequest } from './roll-request.ts';

const table: Character[] = [
  { userId: 'u1', name: 'Lia', concept: 'pescadora' },
  { userId: 'u2', name: 'Tomás', concept: 'padre' },
];

test('parses the standard request line', () => {
  const text = 'A corda range enquanto você sobe.\n\n🎲 Lia, role /rolar 1d20 para escalar o mastro (dificuldade 15)';
  assert.deepEqual(parseRollRequest(text, table), {
    userId: 'u1',
    characterName: 'Lia',
    expression: '1d20',
    goal: 'escalar o mastro',
    difficulty: 15,
  });
});

test('tolerates markdown, case, accents and a missing goal or difficulty', () => {
  assert.equal(parseRollRequest('**🎲 tomas, role /rolar 1d20+1 (dificuldade 10)**', table)?.userId, 'u2');
  assert.deepEqual(parseRollRequest('🎲 Lia, role /rolar 2d6', table), {
    userId: 'u1',
    characterName: 'Lia',
    expression: '2d6',
  });
});

test('uses the last request when there is more than one', () => {
  const text = '🎲 Lia, role /rolar 1d20 (dificuldade 10)\n🎲 Tomás, role /rolar 1d20 (dificuldade 15)';
  assert.equal(parseRollRequest(text, table)?.characterName, 'Tomás');
});

test('returns null when there is no valid request for someone at the table', () => {
  assert.equal(parseRollRequest('A noite cai sobre a vila.', table), null);
  assert.equal(parseRollRequest('🎲 Bruno, role /rolar 1d20 (dificuldade 10)', table), null); // not at the table
  assert.equal(parseRollRequest('🎲 Lia, role /rolar abc (dificuldade 10)', table), null); // invalid dice
});

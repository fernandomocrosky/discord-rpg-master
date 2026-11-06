import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CallToAction } from '../orchestrator/call-to-action.ts';
import { narrationReply } from './buttons.ts';

const check = (userId: string, characterName: string): CallToAction => ({
  kind: 'check',
  userId,
  characterName,
  attribute: 'agilidade',
  modifier: 2,
  difficulty: 10,
  goal: 'pular',
  stakes: 'Se falhar, cai.',
});

test('plain narration has no footer', () => {
  assert.equal(narrationReply('', { text: 'A noite cai.', calls: [] }), 'A noite cai.');
});

test('a group call mentions everyone at the table', () => {
  const players = [
    { userId: '1', characterName: 'Lia' },
    { userId: '2', characterName: 'Rui' },
  ];
  const reply = narrationReply('', { text: 'Cena.', calls: [{ kind: 'group', players, prompt: 'o que fazem?' }] });
  assert.match(String(reply), /👉 Vez de <@1> <@2>\nO que fazem\?/);
});

test('each check gets its footer and its own valid button, in rows of five', () => {
  const calls = ['1', '2', '3', '4', '5', '6'].map((id) => check(id, `Personagem ${id}`));
  const reply = narrationReply('Cabeçalho', { text: 'Cena.', calls });
  assert.ok(typeof reply !== 'string');
  assert.match(reply.text, /Teste de \*\*Personagem 6\*\* \(<@6>\)\nPular · Agilidade · dificuldade 10\nSe falhar, cai\./);

  const rows = reply.components.map((row) => row.toJSON()); // toJSON validates against Discord's limits
  assert.deepEqual(rows.map((row) => row.components.length), [5, 1]);
  const first = rows[0]!.components[0]! as { custom_id: string; label: string };
  assert.equal(first.custom_id, 'check:1:agilidade:10');
  assert.equal(first.label, 'Personagem 1: 1d20 +2 (Agilidade)');
});

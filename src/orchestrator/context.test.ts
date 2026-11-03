import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTINUE_PLACEHOLDER } from '../llm/prompts.ts';
import { appendHistory, createCampaign, endSession, setCharacter, setSecrets, startSession } from '../state/campaign.ts';
import { HISTORY_WINDOW, buildContext } from './context.ts';

const base = () =>
  setCharacter(createCampaign('1', { setting: 'Vila costeira', tone: 'mistério', hook: 'Navio vazio' }), {
    userId: 'u1',
    name: 'Lia',
    concept: 'pescadora curiosa',
  });

test('system includes campaign facts, characters and secrets', () => {
  const { system } = buildContext(setSecrets(base(), 'O padre mente.'), '(abra a cena)');
  assert.match(system, /Cenário: Vila costeira/);
  assert.match(system, /Lia \(pescadora curiosa\)/);
  assert.match(system, /Segredos do mestre[\s\S]*O padre mente\./);
});

test('system includes the previous session summary when there is one', () => {
  const c = startSession(endSession(base(), 'Acharam o diário.'));
  assert.match(buildContext(c, '(retome)').system, /Resumo da sessão anterior:\nAcharam o diário\./);
});

test('history entries become user/assistant messages with names', () => {
  let c = appendHistory(base(), { role: 'gm', text: 'O navio range.' });
  c = appendHistory(c, { role: 'player', userId: 'u1', text: 'subo a bordo' });
  c = appendHistory(c, { role: 'roll', userId: 'u1', text: '1d20 = 12 (12)' });
  const { messages } = buildContext(c);
  assert.deepEqual(messages, [
    { role: 'user', content: CONTINUE_PLACEHOLDER }, // history started with the GM
    { role: 'assistant', content: 'O navio range.' },
    { role: 'user', content: 'Lia: subo a bordo' },
    { role: 'user', content: 'Lia rolou 1d20 = 12 (12)' },
  ]);
});

test('only the last HISTORY_WINDOW entries are sent', () => {
  let c = base();
  for (let i = 0; i < HISTORY_WINDOW + 10; i++) {
    c = appendHistory(c, { role: 'player', userId: 'u1', text: `ação ${i}` });
  }
  const { messages } = buildContext(c);
  assert.equal(messages.length, HISTORY_WINDOW);
  assert.equal(messages[0]?.content, 'Lia: ação 10');
});

test('fails when there is nothing for the GM to respond to', () => {
  const c = appendHistory(base(), { role: 'gm', text: 'fim' });
  assert.throws(() => buildContext(c));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_STORED_HISTORY,
  appendHistory,
  createCampaign,
  currentSession,
  endSession,
  lastSummary,
  recordUsage,
  sessionHistory,
  setCharacter,
  setSecrets,
  startSession,
} from './campaign.ts';

const base = () => createCampaign('123', { setting: 'Vila costeira', tone: 'mistério', hook: 'Um navio sem tripulação' });

test('createCampaign opens session 1', () => {
  const c = base();
  assert.equal(currentSession(c)?.number, 1);
  assert.deepEqual(c.characters, {});
});

test('setCharacter creates and replaces by userId', () => {
  let c = setCharacter(base(), { userId: 'u1', name: 'Lia', concept: 'pescadora curiosa' });
  c = setCharacter(c, { userId: 'u1', name: 'Lia', concept: 'pescadora desconfiada' });
  assert.equal(Object.keys(c.characters).length, 1);
  assert.equal(c.characters.u1?.concept, 'pescadora desconfiada');
});

test('appendHistory keeps only the latest entries', () => {
  let c = base();
  for (let i = 0; i < MAX_STORED_HISTORY + 5; i++) {
    c = appendHistory(c, { role: 'player', userId: 'u1', text: `ação ${i}` });
  }
  assert.equal(c.history.length, MAX_STORED_HISTORY);
  assert.equal(c.history[0]?.text, 'ação 5');
});

test('recordUsage adds tokens to the current session', () => {
  let c = recordUsage(base(), { inputTokens: 100, outputTokens: 20 });
  c = recordUsage(c, { inputTokens: 50, outputTokens: 10 });
  assert.deepEqual(currentSession(c)?.usage, { inputTokens: 150, outputTokens: 30, calls: 2 });
});

test('session lifecycle: end, resume with summary, new session starts at zero', () => {
  let c = endSession(base(), 'Os heróis acharam o diário do capitão.');
  assert.equal(currentSession(c), undefined);
  assert.equal(lastSummary(c), 'Os heróis acharam o diário do capitão.');
  assert.throws(() => recordUsage(c, { inputTokens: 1, outputTokens: 1 }));

  c = startSession(c);
  assert.equal(currentSession(c)?.number, 2);
  assert.equal(currentSession(c)?.usage.calls, 0);
  assert.equal(lastSummary(c), 'Os heróis acharam o diário do capitão.');
});

test('cannot start two sessions or end without one', () => {
  assert.throws(() => startSession(base()));
  assert.throws(() => endSession(endSession(base(), 'x'), 'y'));
});

test('functions do not mutate the original campaign', () => {
  const c = base();
  appendHistory(c, { role: 'gm', text: 'oi' });
  recordUsage(c, { inputTokens: 1, outputTokens: 1 });
  assert.equal(c.history.length, 0);
  assert.equal(currentSession(c)?.usage.calls, 0);
});

test('setSecrets stores GM-only notes', () => {
  const c = setSecrets(base(), 'O padre quer queimar o diário.');
  assert.equal(c.secrets, 'O padre quer queimar o diário.');
});

test('sessionHistory returns only entries from the ongoing session', () => {
  const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
  let c = createCampaign('123', { setting: 's', tone: 't', hook: 'h' }, t(0));
  c = appendHistory(c, { role: 'gm', text: 'sessão 1' }, t(1));
  c = endSession(c, 'resumo', t(2));
  assert.deepEqual(sessionHistory(c), []);

  c = startSession(c, t(3));
  c = appendHistory(c, { role: 'gm', text: 'sessão 2' }, t(4));
  assert.deepEqual(sessionHistory(c).map((e) => e.text), ['sessão 2']);
});

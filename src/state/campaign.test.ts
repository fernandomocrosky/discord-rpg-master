import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_STORED_HISTORY,
  addParticipant,
  appendHistory,
  characterAttributes,
  charactersAtTable,
  createCampaign,
  currentSession,
  endSession,
  lastSummary,
  recordSetupUsage,
  recordUsage,
  sessionHistory,
  setCharacter,
  setSecrets,
  startSession,
  totalUsage,
  turnOrder,
} from './campaign.ts';

const base = () => createCampaign('123', { setting: 'Vila costeira', tone: 'mistério', hook: 'Um navio sem tripulação' });
const inSession = () => startSession(base(), ['u1']);

test('createCampaign starts with no session open', () => {
  const c = base();
  assert.equal(currentSession(c), undefined);
  assert.deepEqual(c.sessions, []);
  assert.deepEqual(c.characters, {});
});

test('setCharacter creates and replaces by userId', () => {
  let c = setCharacter(base(), { userId: 'u1', name: 'Lia', concept: 'pescadora curiosa' });
  c = setCharacter(c, { userId: 'u1', name: 'Lia', concept: 'pescadora desconfiada' });
  assert.equal(Object.keys(c.characters).length, 1);
  assert.equal(c.characters.u1?.concept, 'pescadora desconfiada');
});

test('setSecrets stores GM-only notes', () => {
  const c = setSecrets(base(), 'O padre quer queimar o diário.');
  assert.equal(c.secrets, 'O padre quer queimar o diário.');
});

test('appendHistory keeps only the latest entries', () => {
  let c = base();
  for (let i = 0; i < MAX_STORED_HISTORY + 5; i++) {
    c = appendHistory(c, { role: 'player', userId: 'u1', text: `ação ${i}` });
  }
  assert.equal(c.history.length, MAX_STORED_HISTORY);
  assert.equal(c.history[0]?.text, 'ação 5');
});

test('startSession records participants without duplicates', () => {
  const c = startSession(base(), ['u1', 'u2', 'u1']);
  assert.equal(currentSession(c)?.number, 1);
  assert.deepEqual(currentSession(c)?.participants, ['u1', 'u2']);
});

test('addParticipant adds a late player once', () => {
  let c = addParticipant(inSession(), 'u2');
  c = addParticipant(c, 'u2');
  assert.deepEqual(currentSession(c)?.participants, ['u1', 'u2']);
  assert.throws(() => addParticipant(base(), 'u2'));
});

test('recordUsage adds tokens to the current session', () => {
  let c = recordUsage(inSession(), { inputTokens: 100, outputTokens: 20 });
  c = recordUsage(c, { inputTokens: 50, outputTokens: 10 });
  assert.deepEqual(currentSession(c)?.usage, { inputTokens: 150, outputTokens: 30, calls: 2 });
  assert.throws(() => recordUsage(base(), { inputTokens: 1, outputTokens: 1 }));
});

test('recordSetupUsage tracks campaign creation cost outside sessions', () => {
  const c = recordSetupUsage(base(), { inputTokens: 80, outputTokens: 40 });
  assert.deepEqual(c.setupUsage, { inputTokens: 80, outputTokens: 40, calls: 1 });
});

test('session lifecycle: end, resume with summary, new session starts at zero', () => {
  let c = endSession(inSession(), 'Os heróis acharam o diário do capitão.');
  assert.equal(currentSession(c), undefined);
  assert.equal(lastSummary(c), 'Os heróis acharam o diário do capitão.');
  assert.throws(() => recordUsage(c, { inputTokens: 1, outputTokens: 1 }));

  c = startSession(c, ['u2']);
  assert.equal(currentSession(c)?.number, 2);
  assert.equal(currentSession(c)?.usage.calls, 0);
  assert.deepEqual(currentSession(c)?.participants, ['u2']);
  assert.equal(lastSummary(c), 'Os heróis acharam o diário do capitão.');
});

test('cannot start two sessions or end without one', () => {
  assert.throws(() => startSession(inSession(), ['u1']));
  assert.throws(() => endSession(base(), 'x'));
});

test('sessionHistory returns only entries from the ongoing session', () => {
  const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
  let c = startSession(createCampaign('123', { setting: 's', tone: 't', hook: 'h' }, t(0)), ['u1'], t(0));
  c = appendHistory(c, { role: 'gm', text: 'sessão 1' }, t(1));
  c = endSession(c, 'resumo', t(2));
  assert.deepEqual(sessionHistory(c), []);

  c = startSession(c, ['u1'], t(3));
  c = appendHistory(c, { role: 'gm', text: 'sessão 2' }, t(4));
  assert.deepEqual(sessionHistory(c).map((e) => e.text), ['sessão 2']);
});

test('functions do not mutate the original campaign', () => {
  const c = inSession();
  appendHistory(c, { role: 'gm', text: 'oi' });
  recordUsage(c, { inputTokens: 1, outputTokens: 1 });
  addParticipant(c, 'u9');
  assert.equal(c.history.length, 0);
  assert.equal(currentSession(c)?.usage.calls, 0);
  assert.deepEqual(currentSession(c)?.participants, ['u1']);
});

test('charactersAtTable lists only characters of players in the session', () => {
  let c = setCharacter(base(), { userId: 'u1', name: 'Lia', concept: 'pescadora' });
  c = setCharacter(c, { userId: 'u2', name: 'Tomás', concept: 'padre' });
  assert.deepEqual(charactersAtTable(c), []);
  c = startSession(c, ['u2', 'u3']); // u3 has no character
  assert.deepEqual(charactersAtTable(c).map((ch) => ch.name), ['Tomás']);
});

test('totalUsage sums setup and every session', () => {
  let c = recordSetupUsage(base(), { inputTokens: 100, outputTokens: 50 });
  c = recordUsage(startSession(c, ['u1']), { inputTokens: 10, outputTokens: 5 });
  c = recordUsage(startSession(endSession(c, 'r'), ['u1']), { inputTokens: 1, outputTokens: 1 });
  assert.deepEqual(totalUsage(c), { inputTokens: 111, outputTokens: 56, calls: 3 });
});

test('characterAttributes defaults older characters to +0', () => {
  assert.deepEqual(characterAttributes({ userId: 'u1', name: 'Lia', concept: 'x' }), {
    forca: 0,
    agilidade: 0,
    mente: 0,
    presenca: 0,
  });
  const attributes = { forca: 2, agilidade: 1, mente: 0, presenca: -1 };
  assert.deepEqual(characterAttributes({ userId: 'u1', name: 'Lia', concept: 'x', attributes }), attributes);
});

test('turnOrder starts with whoever has gone longest without acting', () => {
  let c = base();
  for (const [userId, name] of [['u1', 'Lia'], ['u2', 'Tomás'], ['u3', 'Rui']] as const) {
    c = setCharacter(c, { userId, name, concept: 'x' });
  }
  c = startSession(c, ['u1', 'u2', 'u3']);
  const order = () => turnOrder(c).map(({ character, waiting }) => [character.name, waiting]);
  assert.deepEqual(order(), [['Lia', null], ['Tomás', null], ['Rui', null]]);

  c = appendHistory(c, { role: 'player', userId: 'u1', text: 'abro a porta' });
  c = appendHistory(c, { role: 'gm', text: 'range' });
  c = appendHistory(c, { role: 'check', userId: 'u2', text: 'teste' });
  c = appendHistory(c, { role: 'gm', text: 'consegue' });
  c = appendHistory(c, { role: 'player', userId: 'u2', text: 'entro' });
  assert.deepEqual(order(), [['Rui', null], ['Lia', 2], ['Tomás', 0]]);
});

test('turnOrder ignores what happened before the session', () => {
  let c = setCharacter(base(), { userId: 'u1', name: 'Lia', concept: 'x' });
  c = appendHistory(c, { role: 'player', userId: 'u1', text: 'antes' }, new Date('2020-01-01'));
  c = startSession(c, ['u1'], new Date('2020-01-02'));
  assert.deepEqual(turnOrder(c).map((s) => s.waiting), [null]);
});

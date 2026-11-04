import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaign,
  endSession,
  recordSetupUsage,
  recordUsage,
  setCharacter,
  setSecrets,
  startSession,
} from '../state/campaign.ts';
import { campaignStatus } from './status.ts';

const base = () => {
  let c = createCampaign('1', { setting: 'Vila costeira', tone: 'mistério', hook: 'Navio vazio' });
  c = setSecrets(c, 'O PADRE É O CULPADO');
  c = setCharacter(c, { userId: 'u1', name: 'Lia', concept: 'pescadora' });
  return setCharacter(c, { userId: 'u2', name: 'Tomás', concept: 'padre' });
};

test('never exposes the GM secrets', () => {
  const status = campaignStatus(startSession(base(), ['u1']));
  assert.doesNotMatch(JSON.stringify(status), /PADRE É O CULPADO/);
});

test('before the first session: no session, everyone listed as other characters', () => {
  const status = campaignStatus(base());
  assert.equal(status.session, null);
  assert.deepEqual(status.atTable, []);
  assert.deepEqual(status.otherCharacters.map((c) => c.name), ['Lia', 'Tomás']);
  assert.equal(status.usage.session, undefined);
});

test('ongoing session: table, session usage and campaign total', () => {
  let c = recordSetupUsage(base(), { inputTokens: 100, outputTokens: 50 });
  c = recordUsage(startSession(c, ['u1']), { inputTokens: 10, outputTokens: 5 });
  const status = campaignStatus(c);

  assert.equal(status.session?.number, 1);
  assert.equal(status.session?.ongoing, true);
  assert.deepEqual(status.atTable.map((ch) => ch.name), ['Lia']);
  assert.deepEqual(status.otherCharacters.map((ch) => ch.name), ['Tomás']);
  assert.deepEqual(status.usage.session, { inputTokens: 10, outputTokens: 5, calls: 1 });
  assert.deepEqual(status.usage.total, { inputTokens: 110, outputTokens: 55, calls: 2 });
});

test('ended session: shows when it ended and the summary', () => {
  const status = campaignStatus(endSession(startSession(base(), ['u1']), 'Acharam o diário.'));
  assert.equal(status.session?.ongoing, false);
  assert.ok(status.session?.endedAt);
  assert.equal(status.lastSummary, 'Acharam o diário.');
  assert.equal(status.usage.session, undefined);
});

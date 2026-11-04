import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendHistory, createCampaign } from './campaign.ts';
import { JsonCampaignStore } from './store.ts';

async function withStore(fn: (store: JsonCampaignStore, dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rpg-bot-test-'));
  try {
    await fn(new JsonCampaignStore(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const newCampaign = () => createCampaign('42', { setting: 's', tone: 't', hook: 'h' });

test('load returns null for a channel without a campaign', () =>
  withStore(async (store) => {
    assert.equal(await store.load('42'), null);
  }));

test('update saves and load reads it back', () =>
  withStore(async (store) => {
    await store.update('42', () => newCampaign());
    const loaded = await store.load('42');
    assert.equal(loaded?.hook, 'h');
  }));

test('concurrent updates on the same channel do not overwrite each other', () =>
  withStore(async (store) => {
    await store.update('42', () => newCampaign());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.update('42', async (c) => {
          await new Promise((r) => setTimeout(r, Math.random() * 5)); // simulate async work
          return appendHistory(c!, { role: 'player', userId: 'u', text: `ação ${i}` });
        }),
      ),
    );
    const loaded = await store.load('42');
    assert.equal(loaded?.history.length, 20);
    assert.deepEqual(
      loaded?.history.map((h) => h.text),
      Array.from({ length: 20 }, (_, i) => `ação ${i}`),
    );
  }));

test('an error inside update saves nothing and does not block the queue', () =>
  withStore(async (store) => {
    await store.update('42', () => newCampaign());
    await assert.rejects(
      store.update('42', () => {
        throw new Error('falhou');
      }),
      /falhou/,
    );
    await store.update('42', (c) => appendHistory(c!, { role: 'gm', text: 'ok' }));
    assert.equal((await store.load('42'))?.history.length, 1);
  }));

test('rejects a channelId that is not a Discord ID', () =>
  withStore(async (store) => {
    await assert.rejects(store.load('../etc/passwd'), /Invalid channelId/);
  }));

test('archive moves the campaign out and frees the channel', () =>
  withStore(async (store, dir) => {
    await store.update('42', () => newCampaign());
    assert.equal(await store.archive('42', new Date(Date.UTC(2026, 10, 4, 12, 30))), true);

    assert.equal(await store.load('42'), null);
    assert.deepEqual(await readdir(path.join(dir, 'archive')), ['42-2026-11-04T12-30-00-000Z.json']);
    assert.equal(await store.archive('42'), false);
  }));

test('archive waits for a pending update on the same channel', () =>
  withStore(async (store) => {
    await store.update('42', () => newCampaign());
    const slowUpdate = store.update('42', async (c) => {
      await new Promise((r) => setTimeout(r, 20));
      return appendHistory(c!, { role: 'gm', text: 'ainda escrevendo' });
    });
    const archived = store.archive('42');
    await slowUpdate;
    assert.equal(await archived, true);
    assert.equal(await store.load('42'), null); // the update did not recreate the file after archiving
  }));

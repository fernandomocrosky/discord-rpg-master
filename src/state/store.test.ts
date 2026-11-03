import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendHistory, createCampaign } from './campaign.ts';
import { JsonCampaignStore } from './store.ts';

async function withStore(fn: (store: JsonCampaignStore) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rpg-bot-test-'));
  try {
    await fn(new JsonCampaignStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const newCampaign = () => createCampaign('42', { setting: 's', tone: 't', hook: 'h' });

test('load devolve null para canal sem campanha', () =>
  withStore(async (store) => {
    assert.equal(await store.load('42'), null);
  }));

test('update salva e load lê de volta', () =>
  withStore(async (store) => {
    await store.update('42', () => newCampaign());
    const loaded = await store.load('42');
    assert.equal(loaded?.hook, 'h');
  }));

test('updates simultâneos no mesmo canal não se sobrescrevem', () =>
  withStore(async (store) => {
    await store.update('42', () => newCampaign());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.update('42', async (c) => {
          await new Promise((r) => setTimeout(r, Math.random() * 5)); // simula trabalho assíncrono
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

test('erro dentro de update não salva e não trava a fila', () =>
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

test('rejeita channelId que não é ID do Discord', () =>
  withStore(async (store) => {
    await assert.rejects(store.load('../etc/passwd'), /channelId inválido/);
  }));

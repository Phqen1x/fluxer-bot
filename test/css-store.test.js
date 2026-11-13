import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CssStore } from '../src/css-store.js';

async function tempStore(extraCfg = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxer-bot-test-'));
  const store = new CssStore({
    dataDir,
    cssOutputPath: path.join(dataDir, 'custom.css'),
    publicBaseUrl: 'https://css.example.com',
    hostUserId: null,
    ...extraCfg,
  });
  await store.init();
  return store;
}

test('undo/redo walk one user\'s history both ways', async () => {
  const store = await tempStore();
  const u = 'user-1';
  await store.apply(u, 'a', { name: 'a' });
  await store.apply(u, 'b', { name: 'b' });
  await store.apply(u, 'c', { name: 'c' });
  assert.equal(store.current(u), 'c');

  await store.undo(u);
  assert.equal(store.current(u), 'b');
  await store.undo(u);
  assert.equal(store.current(u), 'a');
  await store.undo(u); // back to the empty string the store started with
  assert.equal(store.current(u), '');
  await assert.rejects(() => store.undo(u));

  await store.redo(u);
  assert.equal(store.current(u), 'a');
  await store.redo(u);
  assert.equal(store.current(u), 'b');
  await store.redo(u);
  assert.equal(store.current(u), 'c');
  await assert.rejects(() => store.redo(u));
});

test('applying a fresh change clears that user\'s redo stack', async () => {
  const store = await tempStore();
  const u = 'user-1';
  await store.apply(u, 'a');
  await store.apply(u, 'b');
  await store.undo(u);
  assert.equal(store.current(u), 'a');
  await store.apply(u, 'z'); // diverge instead of redoing
  assert.equal(store.current(u), 'z');
  await assert.rejects(() => store.redo(u));
});

test('two users are fully independent', async () => {
  const store = await tempStore();
  await store.apply('alice', 'alice-css', { name: 'alice-theme' });
  await store.apply('bob', 'bob-css', { name: 'bob-theme' });
  assert.equal(store.current('alice'), 'alice-css');
  assert.equal(store.current('bob'), 'bob-css');
  await store.undo('alice');
  assert.equal(store.current('alice'), '');
  assert.equal(store.current('bob'), 'bob-css'); // untouched by alice's undo
  assert.notEqual(store.url('alice'), store.url('bob'));
});

test('state survives a restart (new CssStore instance, same data dir), for every user', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxer-bot-test-'));
  const cfg = { dataDir, cssOutputPath: path.join(dataDir, 'custom.css'), publicBaseUrl: 'https://css.example.com', hostUserId: null };
  const store1 = new CssStore(cfg);
  await store1.init();
  await store1.apply('alice', 'one', { name: 'one' });
  await store1.apply('alice', 'two', { name: 'two' });
  await store1.undo('alice'); // current = 'one', redoStack has 'two'
  await store1.apply('bob', 'bob-css');

  const store2 = new CssStore(cfg); // simulates a process restart
  await store2.init();
  assert.equal(store2.current('alice'), 'one');
  assert.deepEqual(store2.spec('alice'), { name: 'one' });
  await store2.redo('alice');
  assert.equal(store2.current('alice'), 'two');
  assert.equal(store2.current('bob'), 'bob-css');
});

test('only hostUserId gets the local file sink; everyone else just gets a URL', async () => {
  const store = await tempStore({ hostUserId: 'host-1' });
  const hostReport = await store.apply('host-1', 'body{color:red}');
  assert.ok(hostReport.some((r) => r.startsWith('file:')));
  const otherReport = await store.apply('someone-else', 'body{color:blue}');
  assert.ok(!otherReport.some((r) => r.startsWith('file:')));
  assert.ok(otherReport.some((r) => r.startsWith('url:')));
});

test('personal profiles are stored separately per user', async () => {
  const store = await tempStore();
  await store.apply('alice', 'alice-css');
  await store.apply('bob', 'bob-css');
  await store.saveProfile('alice', 'mytheme');
  await store.saveProfile('bob', 'mytheme'); // same name, different user — must not collide
  assert.deepEqual(await store.listProfiles('alice'), ['mytheme']);
  assert.deepEqual(await store.listProfiles('bob'), ['mytheme']);
  await store.apply('alice', 'changed');
  await store.loadProfile('alice', 'mytheme');
  assert.equal(store.current('alice'), 'alice-css');
  assert.equal(store.current('bob'), 'bob-css'); // untouched
});

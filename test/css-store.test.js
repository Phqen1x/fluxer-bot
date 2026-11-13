import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CssStore } from '../src/css-store.js';

async function tempStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxer-bot-test-'));
  const store = new CssStore({ dataDir, cssOutputPath: path.join(dataDir, 'custom.css') });
  await store.init();
  return store;
}

test('undo/redo walk the history both ways', async () => {
  const store = await tempStore();
  await store.apply('a', { name: 'a' });
  await store.apply('b', { name: 'b' });
  await store.apply('c', { name: 'c' });
  assert.equal(store.current, 'c');

  await store.undo();
  assert.equal(store.current, 'b');
  await store.undo();
  assert.equal(store.current, 'a');
  await store.undo(); // back to the empty string the store started with
  assert.equal(store.current, '');
  await assert.rejects(() => store.undo());

  await store.redo();
  assert.equal(store.current, 'a');
  await store.redo();
  assert.equal(store.current, 'b');
  await store.redo();
  assert.equal(store.current, 'c');
  await assert.rejects(() => store.redo());
});

test('applying a fresh change clears the redo stack', async () => {
  const store = await tempStore();
  await store.apply('a');
  await store.apply('b');
  await store.undo();
  assert.equal(store.current, 'a');
  await store.apply('z'); // diverge instead of redoing
  assert.equal(store.current, 'z');
  await assert.rejects(() => store.redo());
});

test('state survives a restart (new CssStore instance, same data dir)', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fluxer-bot-test-'));
  const cfg = { dataDir, cssOutputPath: path.join(dataDir, 'custom.css') };
  const store1 = new CssStore(cfg);
  await store1.init();
  await store1.apply('one', { name: 'one' });
  await store1.apply('two', { name: 'two' });
  await store1.undo(); // current = 'one', redoStack has 'two'

  const store2 = new CssStore(cfg); // simulates a process restart
  await store2.init();
  assert.equal(store2.current, 'one');
  assert.deepEqual(store2.spec, { name: 'one' });
  await store2.redo();
  assert.equal(store2.current, 'two');
});

// Holds every user's active CSS, undo/redo history, and named profiles on disk, keyed by
// Fluxer user ID, and pushes changes to that user's sinks. Everyone gets a personal HTTP URL
// (see #serve); only `config.hostUserId`, if set, also gets the local file write + CDP
// injection, since those two only make sense for whoever is actually running this process on
// their own machine. All of it is persisted to data/state.json so a restart doesn't lose it.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const STYLE_ID = 'fluxer-lemonade-css';
const FILE_HEADER = '/**\n * @name Lemonade AI Theme\n * @description Written by fluxer-lemonade-bot. Edits are applied live.\n */\n\n';
const safeName = (n) => {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(n)) throw new Error('Profile names: letters, digits, - and _ (max 40 chars)');
  return n.toLowerCase();
};
// User IDs come from the gateway (platform snowflakes), but this also becomes part of a file
// path and a URL segment, so it's sanitized defensively rather than trusted as-is.
const safeUserDir = (id) => {
  const s = String(id).replace(/[^A-Za-z0-9_-]/g, '');
  if (!s) throw new Error('Invalid user id');
  return s;
};
const emptySlot = () => ({ current: '', spec: null, history: [], redoStack: [] });

export class CssStore {
  constructor(config) {
    this.cfg = config;
    this.users = new Map(); // userId -> { current, spec, history, redoStack }
    this.profileRoot = path.join(config.dataDir, 'profiles');
    this.statePath = path.join(config.dataDir, 'state.json');
  }

  async init() {
    await fs.mkdir(this.profileRoot, { recursive: true });
    await fs.mkdir(path.dirname(this.cfg.cssOutputPath), { recursive: true });
    await this.#loadState();
    if (this.cfg.cssServerPort) this.#serve();
  }

  #slot(userId) {
    let s = this.users.get(userId);
    if (!s) { s = emptySlot(); this.users.set(userId, s); }
    return s;
  }

  async #loadState() {
    let saved;
    try { saved = JSON.parse(await fs.readFile(this.statePath, 'utf8')); }
    catch { return; } // first run on this install
    if (saved.users) {
      for (const [id, slot] of Object.entries(saved.users)) {
        this.users.set(id, {
          current: slot.current ?? '',
          spec: slot.spec ?? null,
          history: Array.isArray(slot.history) ? slot.history : [],
          redoStack: Array.isArray(slot.redoStack) ? slot.redoStack : [],
        });
      }
      return;
    }
    // Pre-multi-user state.json ({current, spec, history, redoStack} at the top level, from
    // before this was per-user): belongs to whoever was running the bot solo. Migrate it under
    // hostUserId rather than silently discarding it; without one, there's no way to know whose
    // it was, so it's kept under a fixed fallback key instead of being lost.
    if (typeof saved.current === 'string') {
      const id = this.cfg.hostUserId ?? '_legacy';
      this.users.set(id, {
        current: saved.current,
        spec: saved.spec ?? null,
        history: Array.isArray(saved.history) ? saved.history : [],
        redoStack: Array.isArray(saved.redoStack) ? saved.redoStack : [],
      });
    }
  }

  async #saveState() {
    const users = {};
    for (const [id, slot] of this.users) users[id] = slot;
    await fs.writeFile(this.statePath, JSON.stringify({ users }));
  }

  #serve() {
    this.server = http.createServer((req, res) => {
      const url = req.url?.split('?')[0] ?? '';
      let css = null;
      if (url === '/custom.css' && this.cfg.hostUserId) {
        css = this.#slot(this.cfg.hostUserId).current;
      } else {
        const m = /^\/css\/([^/]+)\.css$/.exec(url);
        if (m) css = this.#slot(decodeURIComponent(m[1])).current;
      }
      if (css === null) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(css || '/* no theme set yet */\n');
    });
    this.server.listen(this.cfg.cssServerPort, '127.0.0.1'); // loopback only; a Cloudflare Tunnel or similar fronts this for remote users
    this.server.on('error', (e) => console.warn(`CSS server: ${e.message}`));
  }

  current(userId) { return this.#slot(userId).current; }
  spec(userId) { return this.#slot(userId).spec; }
  url(userId) { return `${this.cfg.publicBaseUrl}/css/${encodeURIComponent(userId)}.css`; }

  /** Apply new CSS for one user. Returns a report of which sinks succeeded. */
  async apply(userId, css, spec = null, { recordHistory = true } = {}) {
    const slot = this.#slot(userId);
    if (recordHistory) {
      slot.history.push({ css: slot.current, spec: slot.spec });
      if (slot.history.length > 20) slot.history.shift();
      slot.redoStack = []; // a fresh change replaces whatever undo() had set up to redo
    }
    slot.current = css;
    slot.spec = spec;
    await this.#saveState();
    return this.#push(userId);
  }

  async undo(userId) {
    const slot = this.#slot(userId);
    if (!slot.history.length) throw new Error('Nothing to undo');
    slot.redoStack.push({ css: slot.current, spec: slot.spec });
    if (slot.redoStack.length > 20) slot.redoStack.shift();
    ({ css: slot.current, spec: slot.spec } = slot.history.pop());
    await this.#saveState();
    return this.#push(userId);
  }

  async redo(userId) {
    const slot = this.#slot(userId);
    if (!slot.redoStack.length) throw new Error('Nothing to redo');
    slot.history.push({ css: slot.current, spec: slot.spec });
    if (slot.history.length > 20) slot.history.shift();
    ({ css: slot.current, spec: slot.spec } = slot.redoStack.pop());
    await this.#saveState();
    return this.#push(userId);
  }

  async #push(userId) {
    const report = [`url: ${this.url(userId)}`];
    if (userId !== this.cfg.hostUserId) return report;
    // Only the host's own commands also land on this machine's local client directly.
    const slot = this.#slot(userId);
    try {
      // The @name header makes the file show up with a proper title when linked in Theme Studio.
      await fs.writeFile(this.cfg.cssOutputPath, FILE_HEADER + slot.current);
      report.push(`file: ${this.cfg.cssOutputPath}`);
    } catch (e) { report.push(`file FAILED: ${e.message}`); }
    if (this.cfg.cdpUrl) {
      try { report.push(`live: injected into ${await injectViaCdp(this.cfg.cdpUrl, slot.current)} page(s)`); }
      catch (e) { report.push(`live FAILED: ${e.message}`); }
    }
    return report;
  }

  // ---- profiles (per user) ----
  #profileDir(userId) { return path.join(this.profileRoot, safeUserDir(userId)); }
  async saveProfile(userId, name) {
    name = safeName(name);
    const slot = this.#slot(userId);
    if (!slot.current.trim()) throw new Error('No active CSS to save');
    const dir = this.#profileDir(userId);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}.css`);
    await fs.writeFile(file, slot.current);
    if (slot.spec) await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(slot.spec, null, 2));
    return file;
  }
  async loadProfile(userId, name) {
    name = safeName(name);
    let css;
    try { css = await fs.readFile(path.join(this.#profileDir(userId), `${name}.css`), 'utf8'); }
    catch { throw new Error(`No profile named "${name}"`); }
    let spec = null;
    try { spec = JSON.parse(await fs.readFile(path.join(this.#profileDir(userId), `${name}.json`), 'utf8')); } catch { /* css-only profile */ }
    return this.apply(userId, css, spec);
  }
  async listProfiles(userId) {
    let files;
    try { files = await fs.readdir(this.#profileDir(userId)); }
    catch { return []; } // no profiles saved yet
    return files.filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4)).sort();
  }
  async deleteProfile(userId, name) {
    const n = safeName(name);
    await fs.rm(path.join(this.#profileDir(userId), `${n}.css`));
    await fs.rm(path.join(this.#profileDir(userId), `${n}.json`), { force: true });
  }
}

/** Upsert a <style> element in every page target of a Chromium/Electron DevTools endpoint. */
export async function injectViaCdp(cdpUrl, css) {
  const targets = await (await fetch(`${cdpUrl}/json`, { signal: AbortSignal.timeout(5000) })).json();
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('no debuggable pages at ' + cdpUrl);
  const expression = `(() => {
    let s = document.getElementById(${JSON.stringify(STYLE_ID)});
    if (!s) { s = document.createElement('style'); s.id = ${JSON.stringify(STYLE_ID)}; document.documentElement.appendChild(s); }
    s.textContent = ${JSON.stringify(css)};
    return true;
  })()`;
  let ok = 0;
  await Promise.all(pages.map((p) => new Promise((resolve) => {
    const ws = new WebSocket(p.webSocketDebuggerUrl);
    const done = () => { try { ws.close(); } catch {} resolve(); };
    const timer = setTimeout(done, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } }));
    ws.onmessage = (ev) => { if (JSON.parse(ev.data).id === 1) { ok++; clearTimeout(timer); done(); } };
    ws.onerror = done;
  })));
  if (!ok) throw new Error('injection got no response');
  return ok;
}

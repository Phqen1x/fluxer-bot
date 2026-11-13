// Holds the active CSS, an undo/redo history, and named profiles on disk,
// and pushes changes to every configured "sink" (file / HTTP / DevTools).
// Active CSS + both history stacks are persisted to data/state.json so a restart doesn't
// lose them.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const STYLE_ID = 'fluxer-lemonade-css';
const FILE_HEADER = '/**\n * @name Lemonade AI Theme\n * @description Written by fluxer-lemonade-bot. Edits are applied live.\n */\n\n';
const safeName = (n) => {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(n)) throw new Error('Profile names: letters, digits, - and _ (max 40 chars)');
  return n.toLowerCase();
};

export class CssStore {
  constructor(config) {
    this.cfg = config;
    this.current = '';
    this.spec = null; // design spec that produced `current` (null for hand-edited CSS)
    this.history = []; // undo stack
    this.redoStack = [];
    this.profileDir = path.join(config.dataDir, 'profiles');
    this.statePath = path.join(config.dataDir, 'state.json');
  }

  async init() {
    await fs.mkdir(this.profileDir, { recursive: true });
    await fs.mkdir(path.dirname(this.cfg.cssOutputPath), { recursive: true });
    if (!(await this.#loadState())) {
      // No state.json yet (first run on this install, or an install from before it existed):
      // fall back to just the active CSS file, with empty undo/redo history.
      try { this.current = (await fs.readFile(this.cfg.cssOutputPath, 'utf8')).replace(/^\/\*\*[\s\S]*?\*\/\s*/, ''); } catch { /* first run */ }
    }
    if (this.cfg.cssServerPort) this.#serve();
  }

  async #loadState() {
    try {
      const saved = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      this.current = saved.current ?? '';
      this.spec = saved.spec ?? null;
      this.history = Array.isArray(saved.history) ? saved.history : [];
      this.redoStack = Array.isArray(saved.redoStack) ? saved.redoStack : [];
      return true;
    } catch { return false; }
  }

  async #saveState() {
    const data = { current: this.current, spec: this.spec, history: this.history, redoStack: this.redoStack };
    await fs.writeFile(this.statePath, JSON.stringify(data));
  }

  #serve() {
    this.server = http.createServer((req, res) => {
      if (req.url?.split('?')[0] !== '/custom.css') { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(this.current);
    });
    this.server.listen(this.cfg.cssServerPort, '127.0.0.1'); // loopback only
    this.server.on('error', (e) => console.warn(`CSS server: ${e.message}`));
  }

  /** Apply new CSS. Returns a report of which sinks succeeded. */
  async apply(css, spec = null, { recordHistory = true } = {}) {
    if (recordHistory) {
      this.history.push({ css: this.current, spec: this.spec });
      if (this.history.length > 20) this.history.shift();
      this.redoStack = []; // a fresh change replaces whatever undo() had set up to redo
    }
    this.current = css;
    this.spec = spec;
    await this.#saveState();
    return this.#push();
  }

  async undo() {
    if (!this.history.length) throw new Error('Nothing to undo');
    this.redoStack.push({ css: this.current, spec: this.spec });
    if (this.redoStack.length > 20) this.redoStack.shift();
    ({ css: this.current, spec: this.spec } = this.history.pop());
    await this.#saveState();
    return this.#push();
  }

  async redo() {
    if (!this.redoStack.length) throw new Error('Nothing to redo');
    this.history.push({ css: this.current, spec: this.spec });
    if (this.history.length > 20) this.history.shift();
    ({ css: this.current, spec: this.spec } = this.redoStack.pop());
    await this.#saveState();
    return this.#push();
  }

  async #push() {
    const report = [];
    try {
      // The @name header makes the file show up with a proper title when linked in Theme Studio.
      await fs.writeFile(this.cfg.cssOutputPath, FILE_HEADER + this.current);
      report.push(`file: ${this.cfg.cssOutputPath}`);
    } catch (e) { report.push(`file FAILED: ${e.message}`); }
    if (this.server?.listening) report.push(`http: http://127.0.0.1:${this.cfg.cssServerPort}/custom.css`);
    if (this.cfg.cdpUrl) {
      try { report.push(`live: injected into ${await injectViaCdp(this.cfg.cdpUrl, this.current)} page(s)`); }
      catch (e) { report.push(`live FAILED: ${e.message}`); }
    }
    return report;
  }

  // ---- profiles ----
  async saveProfile(name) {
    name = safeName(name);
    if (!this.current.trim()) throw new Error('No active CSS to save');
    const file = path.join(this.profileDir, `${name}.css`);
    await fs.writeFile(file, this.current);
    if (this.spec) await fs.writeFile(path.join(this.profileDir, `${name}.json`), JSON.stringify(this.spec, null, 2));
    return file;
  }
  async loadProfile(name) {
    name = safeName(name);
    let css;
    try { css = await fs.readFile(path.join(this.profileDir, `${name}.css`), 'utf8'); }
    catch { throw new Error(`No profile named "${name}"`); }
    let spec = null;
    try { spec = JSON.parse(await fs.readFile(path.join(this.profileDir, `${name}.json`), 'utf8')); } catch { /* css-only profile */ }
    return this.apply(css, spec);
  }
  async listProfiles() {
    const files = await fs.readdir(this.profileDir);
    return files.filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4)).sort();
  }
  async deleteProfile(name) {
    const n = safeName(name);
    await fs.rm(path.join(this.profileDir, `${n}.css`));
    await fs.rm(path.join(this.profileDir, `${n}.json`), { force: true });
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

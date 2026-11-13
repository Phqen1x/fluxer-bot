// Minimal Fluxer client: instance discovery, REST, and Gateway (v1, JSON).
import { EventEmitter } from 'node:events';

export async function discover(instance) {
  const res = await fetch(`${instance}/.well-known/fluxer`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Discovery failed: ${res.status} from ${instance}/.well-known/fluxer`);
  const d = await res.json();
  if (!d.endpoints?.api_public) throw new Error('Discovery response has no endpoints.api_public');
  return d.endpoints; // { api_public, gateway, media, ... }
}

export class FluxerRest {
  constructor(endpoints, token) {
    this.endpoints = endpoints;
    this.token = token;
  }
  async request(method, route, body) {
    const res = await fetch(`${this.endpoints.api_public}/v1${route}`, {
      method,
      headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      const retry = Number((await res.json().catch(() => ({}))).retry_after ?? 1);
      await new Promise((r) => setTimeout(r, retry * 1000));
      return this.request(method, route, body);
    }
    if (!res.ok) throw new Error(`Fluxer ${method} ${route} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
  }
  me() { return this.request('GET', '/applications/@me'); }
  gatewayInfo() { return this.request('GET', '/gateway/bot'); }
  // Discord-style limit is 2000 chars; chunk conservatively.
  async send(channelId, content, extra = {}) {
    for (const chunk of splitMessage(content, 1900)) {
      await this.request('POST', `/channels/${channelId}/messages`, {
        content: chunk,
        allowed_mentions: { parse: [] },
        ...extra,
      });
    }
  }
}

export function splitMessage(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

export class Gateway extends EventEmitter {
  constructor(rest, token) {
    super();
    this.rest = rest;
    this.token = token;
    this.seq = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.closed = false;
    this.ackPending = false;
  }

  async connect(resume = false) {
    const info = await this.rest.gatewayInfo();
    const base = resume && this.resumeUrl ? this.resumeUrl : info.url;
    const url = new URL(base);
    url.searchParams.set('v', '1');
    url.searchParams.set('encoding', 'json');
    const ws = (this.ws = new WebSocket(url));

    ws.onmessage = (ev) => this.#onFrame(JSON.parse(ev.data), ws);
    ws.onerror = (e) => this.emit('warn', `gateway error: ${e.message ?? 'unknown'}`);
    ws.onclose = (ev) => {
      clearInterval(this.hb);
      if (this.closed) return;
      this.emit('warn', `gateway closed (${ev.code}); reconnecting`);
      const fatal = [4004, 4011, 4012].includes(ev.code);
      if (fatal) return this.emit('fatal', new Error(`Gateway closed with fatal code ${ev.code}`));
      const canResume = this.sessionId && ![4000, 4007, 4009].includes(ev.code) ? true : false;
      if (!canResume) { this.sessionId = null; this.seq = null; }
      setTimeout(() => this.connect(canResume).catch((e) => this.emit('warn', e.message)), 3000);
    };
    this.resuming = resume && !!this.sessionId;
  }

  #send(ws, op, d) { ws.send(JSON.stringify({ op, d })); }

  #onFrame(p, ws) {
    if (p.s != null) this.seq = p.s;
    switch (p.op) {
      case 10: { // Hello
        clearInterval(this.hb);
        this.ackPending = false;
        this.hb = setInterval(() => {
          if (this.ackPending) return ws.close(4009, 'no heartbeat ack');
          this.ackPending = true;
          this.#send(ws, 1, this.seq);
        }, p.d.heartbeat_interval);
        if (this.resuming) {
          this.#send(ws, 6, { token: this.token, session_id: this.sessionId, seq: this.seq });
        } else {
          this.#send(ws, 2, {
            token: this.token,
            properties: { os: process.platform, browser: 'fluxer-lemonade-bot', device: 'local' },
          });
        }
        break;
      }
      case 11: this.ackPending = false; break;
      case 1: this.#send(ws, 1, this.seq); break;
      case 7: ws.close(4000, 'reconnect requested'); break;
      case 9: // Invalid session
        if (!p.d) { this.sessionId = null; this.seq = null; }
        ws.close(4000, 'invalid session');
        break;
      case 0:
        if (p.t === 'READY') {
          this.sessionId = p.d.session_id;
          this.resumeUrl = p.d.resume_gateway_url ?? null;
          this.resuming = false;
        }
        this.emit(p.t, p.d);
        break;
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.hb);
    this.ws?.close(1000);
  }
}

import { loadConfig } from './config.js';
import { discover, FluxerRest, Gateway } from './fluxer.js';
import { Lemonade } from './lemonade.js';
import { CssStore } from './css-store.js';
import { Themes } from './themes.js';
import { createActions } from './actions.js';
import { handle } from './commands.js';

const config = loadConfig();
const endpoints = await discover(config.instance);
const rest = new FluxerRest(endpoints, config.botToken);
const app = await rest.me().catch((e) => { throw new Error(`Bot token rejected: ${e.message}`); });

const llm = new Lemonade(config);
const store = new CssStore(config);
await store.init();
const toolbox = createActions({ llm, store, config, themes: new Themes(endpoints, config.userToken) });

const gw = new Gateway(rest, config.botToken);
let selfId = null;
// One queue per user, so a user's own edits never interleave but different users' commands
// run concurrently instead of queuing behind each other.
const queues = new Map();
const lastRun = new Map();
const COOLDOWN_MS = 5000; // keeps one person's spam from piling up LLM calls for everyone else

gw.on('READY', (d) => {
  selfId = d.user.id;
  const hostNote = config.hostUserId ? `; ${config.hostUserId} also gets the local file/CDP sinks` : '; no local host configured, pure shared-HTTP mode';
  console.log(`Ready as ${d.user.username ?? selfId}. Serving any user who messages it${hostNote}.`);
});
gw.on('warn', (m) => console.warn(m));
gw.on('fatal', (e) => { console.error(e.message); process.exit(1); });
let warnedAboutDeletePermission = false;
gw.on('MESSAGE_CREATE', (msg) => {
  const authorId = msg.author?.id;
  if (!authorId || authorId === selfId) return;
  if (!msg.content?.startsWith(config.prefix)) return;
  const queue = queues.get(authorId) ?? Promise.resolve();
  queues.set(authorId, queue.then(async () => {
    if (config.deleteCommandMessages) {
      rest.deleteMessage(msg.channel_id, msg.id).catch((e) => {
        if (warnedAboutDeletePermission) return;
        warnedAboutDeletePermission = true;
        console.warn(`Couldn't delete command message (needs MANAGE_MESSAGES in the channel): ${e.message}`);
      });
    }
    // If the command message is being deleted, don't reference it: by the time a reply lands,
    // the referenced message may already be gone and the reply has nothing to point at.
    const extra = config.deleteCommandMessages ? {} : { message_reference: { message_id: msg.id } };
    const now = Date.now();
    const wait = (lastRun.get(authorId) ?? 0) + COOLDOWN_MS - now;
    if (wait > 0) {
      await rest.send(msg.channel_id, `Slow down a bit — try again in ${Math.ceil(wait / 1000)}s.`, extra).catch(() => {});
      return;
    }
    lastRun.set(authorId, now);
    try {
      const reply = await handle(msg.content, config.prefix, toolbox, authorId);
      if (reply) await rest.send(msg.channel_id, reply, extra);
    } catch (e) {
      console.error(e);
      await rest.send(msg.channel_id, `⚠️ ${e.message}`).catch(() => {});
    }
  }));
});

await gw.connect();
console.log(`Fluxer app "${app.name ?? 'bot'}" connecting to ${endpoints.gateway}; Lemonade model ${config.lemonadeModel}`);
process.on('SIGINT', () => { gw.close(); process.exit(0); });

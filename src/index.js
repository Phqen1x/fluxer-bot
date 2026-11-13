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
let busy = Promise.resolve(); // serialize commands so CSS edits never interleave

gw.on('READY', (d) => { selfId = d.user.id; console.log(`Ready as ${d.user.username ?? selfId}. Obeying user ${config.ownerId} only.`); });
gw.on('warn', (m) => console.warn(m));
gw.on('fatal', (e) => { console.error(e.message); process.exit(1); });
gw.on('MESSAGE_CREATE', (msg) => {
  if (msg.author?.id !== config.ownerId || msg.author.id === selfId) return;
  if (!msg.content?.startsWith(config.prefix)) return;
  busy = busy.then(async () => {
    try {
      const reply = await handle(msg.content, config.prefix, toolbox);
      if (reply) await rest.send(msg.channel_id, reply, { message_reference: { message_id: msg.id } });
    } catch (e) {
      console.error(e);
      await rest.send(msg.channel_id, `⚠️ ${e.message}`).catch(() => {});
    }
  });
});

await gw.connect();
console.log(`Fluxer app "${app.name ?? 'bot'}" connecting to ${endpoints.gateway}; Lemonade model ${config.lemonadeModel}`);
process.on('SIGINT', () => { gw.close(); process.exit(0); });

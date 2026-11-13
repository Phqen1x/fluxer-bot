import path from 'node:path';

const env = process.env;
const need = (k) => {
  if (!env[k]) throw new Error(`Missing required env var ${k} (see .env.example)`);
  return env[k];
};

export function loadConfig() {
  const dataDir = path.resolve(env.DATA_DIR || './data');
  const cssServerPort = env.CSS_SERVER_PORT ? Number(env.CSS_SERVER_PORT) : 7878;
  return {
    instance: need('FLUXER_INSTANCE').replace(/\/+$/, ''),
    botToken: need('FLUXER_BOT_TOKEN'),
    // Optional now. Everyone who messages the bot gets their own CSS + their own URL under
    // PUBLIC_BASE_URL (see css-store.js) regardless of this setting. Set it to your own Fluxer
    // user ID if you also want your own commands to write the local file / inject via CDP into
    // the Fluxer client running on this same machine — those two sinks only make sense for
    // whoever is actually running the bot, so they're skipped for everyone else.
    hostUserId: env.OWNER_USER_ID || null,
    userToken: env.FLUXER_USER_TOKEN || null,
    prefix: env.PREFIX || '!',
    lemonadeUrl: (env.LEMONADE_URL || 'http://127.0.0.1:13305/api/v1').replace(/\/+$/, ''),
    lemonadeModel: env.LEMONADE_MODEL || 'Qwen3-4B-Instruct-2507-GGUF',
    lemonadeKey: env.LEMONADE_API_KEY || null,
    dataDir,
    cssOutputPath: path.resolve(env.CSS_OUTPUT_PATH || path.join(dataDir, 'custom.css')),
    cssServerPort,
    // The base URL other people's personal CSS links are built from, e.g. a Cloudflare Tunnel
    // hostname pointed at this same port. Falls back to a loopback URL that only resolves on
    // this machine, which is fine for solo use but useless to share with anyone else.
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://127.0.0.1:${cssServerPort}`).replace(/\/+$/, ''),
    cdpUrl: env.CDP_URL || null,
    // Needs MANAGE_MESSAGES in the channel; off by default since the bot may not have it.
    deleteCommandMessages: /^(1|true|yes)$/i.test(env.DELETE_COMMAND_MESSAGES || ''),
  };
}

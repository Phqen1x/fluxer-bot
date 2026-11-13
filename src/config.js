import path from 'node:path';

const env = process.env;
const need = (k) => {
  if (!env[k]) throw new Error(`Missing required env var ${k} (see .env.example)`);
  return env[k];
};

export function loadConfig() {
  const dataDir = path.resolve(env.DATA_DIR || './data');
  return {
    instance: need('FLUXER_INSTANCE').replace(/\/+$/, ''),
    botToken: need('FLUXER_BOT_TOKEN'),
    ownerId: need('OWNER_USER_ID'),
    userToken: env.FLUXER_USER_TOKEN || null,
    prefix: env.PREFIX || '!',
    lemonadeUrl: (env.LEMONADE_URL || 'http://127.0.0.1:13305/api/v1').replace(/\/+$/, ''),
    lemonadeModel: env.LEMONADE_MODEL || 'Qwen3-4B-Instruct-2507-GGUF',
    lemonadeKey: env.LEMONADE_API_KEY || null,
    dataDir,
    cssOutputPath: path.resolve(env.CSS_OUTPUT_PATH || path.join(dataDir, 'custom.css')),
    cssServerPort: env.CSS_SERVER_PORT ? Number(env.CSS_SERVER_PORT) : 7878,
    cdpUrl: env.CDP_URL || null,
  };
}

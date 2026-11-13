#!/usr/bin/env node
// Standalone companion to fluxer-lemonade-bot — not part of the bot itself, and has no
// dependency on the rest of this repo. Copy this one file to any machine that just needs to
// receive a theme, without running the bot, Lemonade, or anything else.
//
// What it does: polls a URL (your personal CSS link, from `!css link` in chat) every few
// seconds, and writes the response to a local file only when it actually changes. Link that
// file once in Fluxer's own Theme Studio (it watches local files for changes) and every future
// `!css` command updates your client automatically, with no further action from you.
//
// Usage:
//   node css-sync.js <url> [output-file]
// Example:
//   node css-sync.js https://css.example.com/css/123456789.css
// output-file defaults to ./synced-theme.css in the current directory.
//
// Node >= 18 (uses the built-in fetch). No npm install needed.

const url = process.argv[2];
const outputPath = process.argv[3] || './synced-theme.css';
const POLL_MS = 5000;

if (!url || !/^https?:\/\//i.test(url)) {
  console.error('Usage: node css-sync.js <url> [output-file]');
  console.error('Get your URL by running `!css link` in chat with the bot.');
  process.exit(1);
}

const fs = await import('node:fs/promises');
const path = await import('node:path');

const resolvedOutput = path.resolve(outputPath);
let lastSeen = null;
let announced = false;

async function poll() {
  let text;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[css-sync] ${url} -> HTTP ${res.status}; will keep retrying`);
      return;
    }
    text = await res.text();
  } catch (e) {
    console.warn(`[css-sync] fetch failed (${e.message}); will keep retrying`);
    return;
  }
  if (text === lastSeen) return; // no change since last poll
  lastSeen = text;
  await fs.writeFile(resolvedOutput, text);
  console.log(`[css-sync] updated ${resolvedOutput} (${text.length} bytes)`);
  if (!announced) {
    announced = true;
    console.log('');
    console.log('One-time setup, if you have not done it yet:');
    console.log('  In Fluxer: Settings -> Theme Studio -> link/import a CSS file -> pick:');
    console.log(`  ${resolvedOutput}`);
    console.log('After that, this script keeps that file in sync automatically. Leave it running.');
    console.log('');
  }
}

console.log(`[css-sync] watching ${url}`);
console.log(`[css-sync] writing to ${resolvedOutput} on every change, checking every ${POLL_MS / 1000}s`);
await poll();
setInterval(poll, POLL_MS);

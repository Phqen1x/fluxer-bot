# fluxer-lemonade-bot

A Fluxer application that uses a **local Lemonade** LLM to turn natural language into changes on *your* client.
First feature: describe a look → get CSS → it's injected into your client → optionally save it as a permanent profile.

```
you (Fluxer msg) ─► bot (runs on your PC) ─► Lemonade (localhost) ─► sanitized CSS ─► file / http / live DevTools injection
```

## Why it runs locally
Per the Fluxer docs, bots **cannot** set custom CSS or themes (those routes return 403 for bot tokens), and there are
no slash commands, so commands are plain `!prefix` messages. The bot therefore runs on your machine, obeys only
`OWNER_USER_ID`, and applies CSS locally.

## Setup
1. Start Lemonade (`lemonade-server`) — default API `http://127.0.0.1:13305/api/v1`.
2. Create the application in the client under User Settings → Developer, copy the bot token, and invite it to a server.
3. `cp .env.example .env`, fill in `FLUXER_INSTANCE`, `FLUXER_BOT_TOKEN`, `OWNER_USER_ID`.
4. `npm start` (Node ≥ 22, zero dependencies). `npm test` runs the sanitizer tests.

## Commands (owner only)
| Command | Effect |
|---|---|
| `!css green gradient with red accents` | Design + apply a theme (modifies the current design if one is active, e.g. `!css make the accent softer`) |
| `!css new <desc>` | Start from scratch |
| `!css undo` / `reset` / `show` / `list` | History, clear, print, list profiles |
| `!css save <name> [--upload]` | Save permanently to `data/profiles/<name>.css`; `--upload` also publishes as a Fluxer theme |
| `!css load <name>` / `delete <name>` | Apply / remove a profile |
| `!ai <anything>` | LLM picks the action ("make chat text bigger", "save this as night", "go back") |

New capabilities = add an entry to `src/actions.js`; the `!ai` planner discovers it automatically.

## Getting CSS into the client (one-time setup, then fully automatic)
**Desktop app (recommended):** it can watch a CSS file and re-apply it on every change.
1. Open **Theme Studio** → link/import a CSS file → pick `data/custom.css` (or import the `data/` folder).
2. Done. Every `!css …` now updates the client live — no `@import`, no restart.

(The client filters URLs in custom CSS, so `@import url(http://127.0.0.1:…)` does **not** work.)

**Advanced alternatives:** live injection via DevTools (`--remote-debugging-port=9222` + `CDP_URL`) for the desktop app or a browser.
The web app stores its theme library in browser storage that other programs can't reach, so web users need the DevTools route or to paste CSS manually.

## Honest caveats
- **Untested against a live Fluxer instance** (no instance/token available here). Gateway/REST code follows docs.fluxer.com; the Lemonade → CSS → file/HTTP/profile pipeline was run for real. The CDP injector is untested.
- I couldn't find where the Fluxer desktop client stores its custom-CSS slot, hence the three sinks above.
- **How generation works:** the local model never writes raw CSS. It returns a small JSON design spec (base color, optional gradient, accent, light/dark, text/link color, radius, font) and `src/theme-compiler.js` compiles it into a complete stylesheet using Fluxer's real CSS variables (extracted from the client's shipped stylesheets). That is far more reliable with small models. Limits: it themes colors/gradients/fonts/rounding; it can't restructure layout or hide elements (that needs hand-written selectors; planned as `!css tweak`). Re-extract the variable list if a Fluxer update renames variables.
- `--upload` needs `FLUXER_USER_TOKEN` (a user session token — automating a user account may violate instance rules; it's opt-in). The docs don't say how to activate an uploaded theme ID.
- Generated CSS is sanitized: no `@import`, no external `url()`, balanced braces enforced.

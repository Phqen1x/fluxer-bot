# fluxer-lemonade-bot

A Fluxer application that uses a **local Lemonade** LLM to turn natural language into changes on a client.
Describe a look → get CSS → it's injected into your client → optionally save it as a permanent profile.
Anyone who messages the bot gets their own CSS and their own personal URL — this isn't limited to one person.

```
anyone (Fluxer msg) ─► bot (runs on one PC) ─► Lemonade (localhost) ─► sanitized CSS, kept per-user
                                                                         │
                               host's own client ◄─ file / CDP injection┤
                                       everyone else ◄─ personal HTTP URL┘
```

## Why it runs locally
Per the Fluxer docs, bots **cannot** set custom CSS or themes (those routes return 403 for bot tokens), and there are
no slash commands, so commands are plain `!prefix` messages. The bot therefore has to run somewhere that can write
files and talk to a browser's DevTools port directly — which only ever works for whoever's machine it's running on.
Everyone else gets their theme over a personal HTTP URL instead (see "Hosting this for other people" below).

## Setup
1. Start Lemonade (`lemonade-server`) — default API `http://127.0.0.1:13305/api/v1`.
2. Create the application in the client under User Settings → Developer, copy the bot token, and invite it to a server.
3. `cp .env.example .env`, fill in `FLUXER_INSTANCE`, `FLUXER_BOT_TOKEN`. Set `OWNER_USER_ID` to your own user ID if
   you also want your own client (on this same machine) auto-updated via file/CDP — see `.env.example`.
4. `npm start` (Node ≥ 22, zero dependencies). `npm test` runs the test suite.

## Commands (anyone who messages the bot)
Each user's theme, history, and profiles are completely separate — nobody can see or change anyone else's.

| Command | Effect |
|---|---|
| `!css green gradient with red accents` | Design + apply a theme (modifies the current design if one is active, e.g. `!css make the accent softer`) |
| `!css new <desc>` | Start from scratch |
| `!css undo` / `redo` / `reset` / `show` / `list` | History (up to 20 steps each way, survives restarts), clear, print, list profiles |
| `!css link` | Show your personal CSS URL and how to get it applied automatically |
| `!css save <name> [--upload]` | Save permanently to your own `data/profiles/<your-id>/<name>.css`; `--upload` only works for `OWNER_USER_ID` (it needs a personal account token — see below) |
| `!css load <name>` / `delete <name>` | Apply / remove one of your own profiles |
| `!ai <anything>` | LLM picks the action ("make chat text bigger", "save this as night", "go back") |

New capabilities = add an entry to `src/actions.js`; the `!ai` planner discovers it automatically.

Set `DELETE_COMMAND_MESSAGES=true` in `.env` to have the bot delete `!css ...` command messages after handling them
(needs `MANAGE_MESSAGES` in the channel). Fluxer bots have no interaction/slash-command system, so there's no
ephemeral-message response type to use instead — a reply is always a normal, visible channel message.

A simple per-user cooldown (5s between commands) keeps one person's spamming from piling up LLM calls for everyone
else; there's no other access control, so anyone who can message the bot can use it.

## Getting CSS into a client

**`OWNER_USER_ID`'s own client, on the same machine as the bot (one-time setup, then fully automatic):**
the desktop app can watch a CSS file and re-apply it on every change.
1. Open **Theme Studio** → link/import a CSS file → pick `data/custom.css` (or import the `data/` folder).
2. Done. Every `!css …` from `OWNER_USER_ID` now updates that client live — no `@import`, no restart.

Advanced alternative for the same user: live injection via DevTools (`--remote-debugging-port=9222` + `CDP_URL`).

**Everyone else, on their own machine:** the Fluxer client has no way to subscribe to a remote URL directly — Theme
Studio can only link a *local* file (confirmed against the client source: every import/link function takes a local
file or folder, never a URL). So each person needs one of:
- **Manual** (zero setup): run `!css link` to get your personal URL, open it, copy the CSS, paste it into your own
  Settings → Quick CSS. Redo this whenever you want to pick up a change.
- **Automatic**: run the tiny standalone script in [`sync/css-sync.js`](sync/css-sync.js) once — it's a single file
  with no dependencies and no connection to the rest of this repo, so it's fine to copy to any machine on its own:
  ```
  node css-sync.js <your-personal-url>
  ```
  Then link the local file it writes in your own Theme Studio, same as step 1 above. From then on, every `!css` you
  run updates your client automatically, same as the host gets — no bot, no Lemonade, no clone of this repo needed.

The web app stores its theme library in browser storage that other programs can't reach, so web users need the
DevTools route (if applicable) or the manual paste option.

## Hosting this for other people

Everyone's CSS is always served at `PUBLIC_BASE_URL/css/<their-user-id>.css` — you just need `PUBLIC_BASE_URL` to
actually reach this machine's `CSS_SERVER_PORT` (default `7878`) from wherever they are. The cleanest way, if you
own a domain, is a **Cloudflare Tunnel**: it makes an outbound-only connection from this machine to Cloudflare, so
there's no port-forwarding, no exposing your home IP, and free HTTPS. Example for a domain like `phqen1x.com`,
picking a subdomain such as `css.phqen1x.com`:

1. Add the domain to a (free) Cloudflare account and point its nameservers at Cloudflare.
2. On this machine: install `cloudflared`, then
   ```
   cloudflared tunnel login
   cloudflared tunnel create fluxer-css
   cloudflared tunnel route dns fluxer-css css.phqen1x.com
   ```
3. Create `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: fluxer-css
   credentials-file: /home/<you>/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: css.phqen1x.com
       service: http://localhost:7878
     - service: http_status:404
   ```
4. `cloudflared tunnel run fluxer-css` (or install it as a system service so it survives reboots:
   `sudo cloudflared service install`, then `cloudflared` reads the same config).
5. Set `PUBLIC_BASE_URL=https://css.phqen1x.com` in `.env` and restart the bot.

The bot's own HTTP server keeps binding to `127.0.0.1` the whole time — `cloudflared` is the only thing that needs
to reach it, and it runs locally too, so nothing about this opens your machine up to the wider internet beyond the
one hostname you chose to route.

## Honest caveats
- **Untested against a live Fluxer instance** (no instance/token available here). Gateway/REST code follows docs.fluxer.com; the Lemonade → CSS → file/HTTP/profile pipeline was run for real. The CDP injector is untested.
- I couldn't find where the Fluxer desktop client stores its custom-CSS slot, hence the three sinks above.
- **How generation works:** the local model never writes raw CSS. It returns a small JSON design spec (base color, optional gradient, accent, light/dark, text/link color, radius, font) and `src/theme-compiler.js` compiles it into a complete stylesheet using Fluxer's real CSS variables (extracted from the client's shipped stylesheets, cross-checked against `fluxerapp/fluxer` on GitHub). That is far more reliable with small models. Limits: it themes colors/gradients/fonts/rounding; it can't restructure layout or hide elements (that needs hand-written selectors; planned as `!css tweak`). Re-extract the variable list / chrome selectors if a Fluxer update renames them.
- **Surfaces are always opaque, even with a gradient.** An earlier version made panels translucent and painted one gradient on `html` so it would show through everywhere. In the real client that doesn't work: `#fluxer-boot-shell`/`.fluxer-boot-app` are opaque unless the desktop "allow transparency" setting is on (off by default), and the channel header (`.headerGlass`) additionally gets `backdrop-filter: blur()` the moment any custom stylesheet is active — so translucent panels rendered as a blurred blend of whatever was behind them, not the theme. A requested gradient is now painted directly, opaque, on a handful of real chrome elements instead (native titlebar, channel header, message scroller, member list), the same way the working hand-written themes we've seen do it.
- `--upload` needs `FLUXER_USER_TOKEN` (a user session token — automating a user account may violate instance rules; it's opt-in). The docs don't say how to activate an uploaded theme ID.
- Generated CSS is sanitized: no `@import`, no external `url()`, balanced braces enforced.

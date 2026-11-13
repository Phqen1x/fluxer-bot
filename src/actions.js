// Action registry: each action is something the bot can do to a user's local client.
// The `!ai` planner lets the LLM pick one; explicit commands call them directly.
// Every action receives (args, { userId }) — userId is whoever sent the message, from the
// gateway, never something the model or a chat argument can set.
import { sanitizeCss } from './sanitize.js';
import { cleanSpec, compileTheme, SPEC_SCHEMA_DOC } from './theme-compiler.js';

const SPEC_SYSTEM = `You are a UI theme designer. Turn the user's request into a JSON design spec for a chat app.
Reply with ONLY a JSON object, exactly this shape:
${SPEC_SCHEMA_DOC}

Guidance:
- "background" is the BASE surface color: for dark mode a very dark shade of the theme hue (e.g. dark green = #0b2a14), for light mode a very light tint.
- "accent" is the highlight color. If the user says "red accents" the accent is red; do NOT make body text red.
- Use "gradient" only when the user asks for a gradient: 2-3 hex colors that all stay dark (dark mode) so text remains readable, and set "background" to the first gradient color.
- Leave "text" null unless the user asks for a specific text color.
- All colors must be 6-digit hex like #1a2b3c. Never use color names.

Examples:
Request: "green gradient with red accents"
{"name":"Green Red","mode":"dark","background":"#0a2412","gradient":{"angle":135,"colors":["#0a2412","#14532d","#052e16"]},"accent":"#ef4444","text":null,"link":"#f87171","radius":null,"font":null}
Request: "bright clean light theme with orange buttons and rounded corners"
{"name":"Light Orange","mode":"light","background":"#fafafa","gradient":null,"accent":"#f97316","text":null,"link":"#ea580c","radius":14,"font":null}`;

const SYNC_SCRIPT_NOTE = 'Want it applied automatically instead of pasting? Run `!css link` for the one-time local setup.';

// Recognize a request that's scoped to ONLY the font, by name or by the word itself, so it
// never touches colors/background/accent/etc. — handled in code rather than trusted to the
// model, the same reason theme-compiler.js never lets the model write raw CSS: a small local
// model asked to "return the full updated spec" can and does drift other fields even when the
// request only mentioned one of them.
const FONT_WORD = /\b(fonts?|font-family|typeface|typography)\b/i;
const KNOWN_FONT_NAMES = [
  'comic sans', 'comic neue', 'arial', 'helvetica', 'times new roman', 'times', 'courier new',
  'courier', 'verdana', 'georgia', 'garamond', 'impact', 'trebuchet ms', 'trebuchet', 'tahoma',
  'calibri', 'cambria', 'consolas', 'segoe ui', 'segoe', 'roboto', 'open sans', 'lato',
  'montserrat', 'poppins', 'inter', 'ubuntu', 'noto sans', 'source sans', 'nunito', 'raleway',
  'oswald', 'merriweather', 'playfair display', 'lora', 'pt sans', 'pt serif', 'fira sans',
  'fira code', 'jetbrains mono', 'space mono', 'courier prime', 'papyrus', 'bangers', 'pacifico',
  'lobster', 'dancing script', 'permanent marker', 'indie flower', 'caveat', 'monospace',
  'sans-serif', 'sans serif', 'serif', 'cursive', 'system-ui',
];
const FONT_NAME_PATTERN = new RegExp(`\\b(${KNOWN_FONT_NAMES.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
// If any of these also show up, it's not font-only — fall through to the normal full-spec flow.
const NON_FONT_HINT = /\b(background|accent|gradient|theme|dark mode|light mode|radius|rounded|corners?|colou?r)\b|#[0-9a-f]{3,8}\b|\b(red|blue|green|purple|orange|yellow|pink|teal|cyan|magenta|black|white|gray|grey)\b/i;
const isFontOnlyRequest = (text) => (FONT_WORD.test(text) || FONT_NAME_PATTERN.test(text)) && !NON_FONT_HINT.test(text);
const FONT_ONLY_PATTERN = /^[\w\s,"'-]{2,80}$/; // same shape cleanSpec already validates spec.font against

const FONT_SYSTEM = `Reply with ONLY a JSON object: {"font": "<CSS font-family list>"}
The value must be a real CSS font-family list ending in a generic fallback, e.g. "Comic Sans MS, Comic Sans, cursive" or "Georgia, serif" or "Fira Code, monospace".
Pick the font that matches the request. Never mention or imply any color, background, or anything else — only the font.`;

export function createActions({ llm, store, config, themes }) {
  const actions = {
    set_css: {
      doc: 'Change how the app looks (colors, gradients, accent, light/dark, rounding, font). args: {"description": string, "fresh": boolean (true = start over instead of modifying the current theme)}',
      async run({ description, fresh }, { userId }) {
        if (!description) throw new Error('Describe the look you want.');
        if (isFontOnlyRequest(description)) return applyFontOnly(description, userId);
        const priorSpec = store.spec(userId);
        const prior = !fresh && priorSpec ? `CURRENT SPEC (modify it as requested, return the full updated spec):\n${JSON.stringify(priorSpec)}\n\n` : '';
        const raw = await llm.chat(
          [{ role: 'system', content: SPEC_SYSTEM }, { role: 'user', content: `${prior}Request: ${description}` }],
          { temperature: 0.3, maxTokens: 600, json: true },
        );
        let parsed;
        try { parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]); }
        catch { throw new Error('The model did not return valid JSON. Try rephrasing, or `!css` again.'); }
        const spec = cleanSpec(parsed);
        const { css } = sanitizeCss(compileTheme(spec));
        const report = await store.apply(userId, css, spec);
        const g = spec.gradient ? `gradient ${spec.gradient.colors.join(' → ')}, ` : '';
        return [`Applied **${spec.name}** (${spec.mode}; base ${spec.base}, ${g}accent ${spec.accent}).`,
          ...report.map((r) => `• ${r}`),
          'Tweak it: `!css make the accent softer`. Revert: `!css undo`. Keep it: `!css save <name>`.',
          SYNC_SCRIPT_NOTE].join('\n');
      },
    },
    reset_css: {
      doc: 'Remove all custom styling. args: {}',
      async run(_args, { userId }) { await store.apply(userId, ''); return 'Custom CSS cleared (undo with `!css undo`).'; },
    },
    undo_css: {
      doc: 'Revert the last CSS change. args: {}',
      async run(_args, { userId }) { await store.undo(userId); return 'Reverted to the previous CSS. Changed your mind? `!css redo`.'; },
    },
    redo_css: {
      doc: 'Re-apply a CSS change that was just undone. args: {}',
      async run(_args, { userId }) { await store.redo(userId); return 'Re-applied. `!css undo` to go back again.'; },
    },
    show_css: {
      doc: 'Show the active CSS. args: {}',
      async run(_args, { userId }) {
        const css = store.current(userId);
        return css.trim() ? '```css\n' + css.trim() + '\n```' : `No custom CSS is active yet. Try \`!css <describe a look>\`.`;
      },
    },
    save_profile: {
      doc: 'Save the active CSS as a permanent named profile. args: {"name": string, "upload": boolean}',
      async run({ name, upload }, { userId }) {
        const file = await store.saveProfile(userId, name);
        let msg = `Saved profile **${name}** → ${file}`;
        if (upload) {
          // The upload API needs a personal Fluxer session token (bots are rejected with 403),
          // configured once for whoever runs this bot — it can't act on an arbitrary chat
          // user's behalf, so this only works for the host themselves.
          if (userId !== config.hostUserId) {
            msg += '\n`--upload` only works for the person running this bot (it needs their own Fluxer account token, not something the bot can do on your behalf).';
          } else {
            msg += '\n' + (await themes.upload(store.current(userId)));
          }
        }
        return msg;
      },
    },
    load_profile: {
      doc: 'Apply a saved profile. args: {"name": string}',
      async run({ name }, { userId }) { await store.loadProfile(userId, name); return `Loaded profile **${name}**.`; },
    },
    list_profiles: {
      doc: 'List saved profiles. args: {}',
      async run(_args, { userId }) { const l = await store.listProfiles(userId); return l.length ? 'Profiles: ' + l.join(', ') : 'No saved profiles yet.'; },
    },
    delete_profile: {
      doc: 'Delete a saved profile. args: {"name": string}',
      async run({ name }, { userId }) { await store.deleteProfile(userId, name); return `Deleted profile **${name}**.`; },
    },
    my_link: {
      doc: 'Show this user their personal CSS URL and how to get it applied automatically. args: {}',
      async run(_args, { userId }) {
        return [
          `Your personal theme URL: ${store.url(userId)}`,
          'It always reflects your latest `!css` change — no login or account info needed to read it.',
          '',
          '**Manual (works right now):** open that URL, copy the CSS, paste it into Fluxer\'s own Settings → Quick CSS. Redo this each time you want to pick up a change.',
          '**Automatic:** run the small sync script against that URL once — see the repo\'s README ("Getting your own theme live-updating") — then link the local file it writes in Fluxer\'s Theme Studio. After that every `!css` here updates your client on its own.',
        ].join('\n');
      },
    },
  };

  /** Change only the font, preserving every other current spec field exactly as-is. */
  async function applyFontOnly(description, userId) {
    const raw = await llm.chat(
      [{ role: 'system', content: FONT_SYSTEM }, { role: 'user', content: description }],
      { temperature: 0.2, maxTokens: 150, json: true },
    );
    let font;
    try { font = String(JSON.parse(raw.match(/\{[\s\S]*\}/)[0]).font ?? '').trim(); }
    catch { throw new Error('The model did not return valid JSON. Try rephrasing, or `!css` again.'); }
    if (!FONT_ONLY_PATTERN.test(font)) throw new Error('The model returned an unusable font value. Try rephrasing.');

    const priorSpec = store.spec(userId);
    let css, spec;
    if (priorSpec) {
      // Re-run the full compiler against the unchanged spec plus this one field: every other
      // variable comes out byte-identical to what's already applied, since compileTheme is a
      // pure function of the spec and nothing but spec.font changed.
      spec = { ...priorSpec, font };
      css = compileTheme(spec);
    } else {
      // Nothing to preserve "sameness" from — the app is at its own defaults, so leave
      // everything else exactly there instead of inventing colors that were never asked for.
      spec = null;
      css = `/* Font only */\n:root, :root[class] { --font-sans: ${font} !important; }\n`;
    }
    const { css: clean } = sanitizeCss(css);
    const report = await store.apply(userId, clean, spec);
    return [`Set the font to **${font}** — nothing else changed.`,
      ...report.map((r) => `• ${r}`),
      'Tweak it further: `!css make the accent softer`. Revert: `!css undo`.',
      SYNC_SCRIPT_NOTE].join('\n');
  }

  /** Natural language -> {action, args}. Falls back to treating text as a CSS request. */
  async function plan(text) {
    const catalog = Object.entries(actions).map(([k, v]) => `- ${k}: ${v.doc}`).join('\n');
    const raw = await llm.chat([
      { role: 'system', content: `You route a user's request to exactly one action for their chat client.\nActions:\n${catalog}\nReply with ONLY JSON: {"action": "<name>", "args": {...}}. If the request is about appearance/styling, use set_css and copy the user's wording into description.` },
      { role: 'user', content: text },
    ], { temperature: 0, maxTokens: 300, json: true });
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      const p = JSON.parse(m[0]);
      if (actions[p.action]) return { action: p.action, args: p.args ?? {} };
    } catch { /* fall through */ }
    return { action: 'set_css', args: { description: text } };
  }

  return { actions, plan };
}

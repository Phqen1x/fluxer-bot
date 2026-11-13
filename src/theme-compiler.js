// Compiles a small design spec (chosen by the LLM) into a COMPLETE Fluxer stylesheet.
// The model only picks colors/intent; code guarantees every variable is real, derived
// consistently, and that nothing references itself.
//
// Surfaces are always opaque. An earlier version made them translucent and painted one
// gradient on `html` so it would show through every panel; in the real client that gradient
// sits behind `#fluxer-boot-shell`/`.fluxer-boot-app`, which are opaque unless the desktop
// "allow transparency" setting is on (off by default), and `.headerGlass` additionally gets
// `backdrop-filter: blur()` the moment any custom stylesheet is active. Together those meant
// most panels rendered a blurred blend of whatever was behind them instead of the theme.
// Gradients are now painted directly, opaque, on the few real chrome elements worth it.
//
// Those same selectors also matter for a second reason: Fluxer supports CSS set outside
// this bot entirely — instance-wide branding (set by a self-hosted instance's admin) and a
// user's own Quick CSS — which can inject a competing stylesheet. The client's own base CSS
// mostly paints panels via `background-color: var(--background-secondary)` etc. with no
// !important, so a competing stylesheet's `!important` rule on a literal selector
// (`[class*="messagesArea"] { background: ... !important }`) wins outright no matter what
// we set the variable to: there's no variable in the way to lose a tie-break on. Matching
// those same real selectors ourselves, later in the document, is how we outrank it instead
// of only touching variables. We still lose to anything injected *after* ours, and this
// doesn't chase every row-hover/selected-state selector, only panel backgrounds.

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHex(c) {
  if (typeof c !== 'string') return null;
  c = c.trim().toLowerCase();
  if (/^[0-9a-f]{6}$/.test(c) || /^[0-9a-f]{3}$/.test(c)) c = '#' + c;
  if (!HEX.test(c)) return null;
  return c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Validate/clean a spec coming from the model. Throws with a useful message. */
export function cleanSpec(raw) {
  const spec = {};
  spec.name = String(raw.name ?? 'AI theme').slice(0, 60);
  spec.mode = raw.mode === 'light' ? 'light' : 'dark';

  const g = raw.gradient;
  if (g && Array.isArray(g.colors)) {
    const colors = g.colors.map(normalizeHex).filter(Boolean).slice(0, 4);
    if (colors.length >= 2) {
      const angle = Number.isFinite(Number(g.angle)) ? ((Number(g.angle) % 360) + 360) % 360 : 135;
      spec.gradient = { angle, colors };
    }
  }
  const bg = (Array.isArray(raw.background) ? raw.background : [raw.background]).map(normalizeHex).filter(Boolean);
  spec.base = bg[0] ?? spec.gradient?.colors[0];
  if (!spec.base) throw new Error('The model did not return a usable background color');

  spec.accent = normalizeHex(raw.accent) ?? '#5865f2';
  spec.text = normalizeHex(raw.text) ?? null;
  spec.link = normalizeHex(raw.link) ?? null;
  if (Number.isFinite(Number(raw.radius))) spec.radius = Math.max(0, Math.min(32, Math.round(Number(raw.radius))));
  if (typeof raw.font === 'string' && /^[\w\s,"'-]{2,80}$/.test(raw.font)) spec.font = raw.font.trim();
  return spec;
}

export function compileTheme(spec) {
  const dark = spec.mode !== 'light';
  const B = spec.base;
  const A = spec.accent;
  // Move "away" from the base toward higher-contrast surfaces.
  const away = dark ? 'white' : 'black';
  const shade = (p) => `color-mix(in srgb, ${B} ${100 - p}%, ${away} ${p}%)`;
  const alpha = (c, p) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
  // Every override below exists to out-rank a competing stylesheet's own selector on the same
  // property, which is a losing bet on document order alone: a competing rule's selector list
  // can incidentally reach higher specificity on an element we're both targeting (e.g. a
  // `:not([style*="..."])` branch matching via a shared base class), which wins over equal
  // !important regardless of which stylesheet loaded later. `:is(sel):is(sel)` doubles our
  // selector's effective specificity defensively, for any sel, without changing what it matches.
  const boost = (sel) => `:is(${sel}):is(${sel})`;
  const rule = (selectors, body) => `${selectors.map(boost).join(',\n')} {\n${body}\n}`;
  const grad = spec.gradient;
  const gradCss = grad && `linear-gradient(${grad.angle}deg, ${grad.colors.join(', ')})`;

  const onBrand = luminance(A) > 0.5 ? '#111111' : '#ffffff';
  // Always set a text color, even when the model didn't ask for one: leaving --text-secondary
  // etc. unset doesn't mean "keep the app's default", it means ceding that variable to
  // whatever competing stylesheet (instance branding, Quick CSS) is also loaded.
  const text = spec.text ?? (dark ? '#f2f2f5' : '#16161a');

  const v = {
    '--background-primary': B,
    '--background-secondary': shade(5),
    '--background-secondary-lighter': shade(8),
    '--background-secondary-alt': shade(11),
    '--background-tertiary': shade(15),
    '--background-channel-header': shade(9),
    '--channel-header-background': shade(9),
    '--guild-list-foreground': shade(12),
    '--background-header-primary': shade(16),
    '--background-header-secondary': shade(16),
    '--background-header-primary-hover': shade(21),
    '--background-textarea': shade(11),
    '--form-surface-background': shade(11),
    // Aliased by the client's own CSS (globals.css) to --background-secondary-lighter /
    // --background-secondary respectively, but set directly here rather than relying on
    // that indirection: it's what the main chat container and guild badges actually paint.
    '--composer-surface-color': shade(8),
    '--guild-badge-surface': shade(5),
    '--panel-control-bg': shade(11),
    '--panel-control-border': alpha(A, 45),
    '--panel-control-divider': alpha(A, 30),
    '--border-color': alpha(A, 28),
    '--background-modifier-hover': alpha(A, 12),
    '--background-modifier-selected': alpha(A, 22),
    '--background-modifier-accent': alpha(A, 20),
    '--background-modifier-accent-focus': alpha(A, 34),
    '--surface-interactive-hover-bg': alpha(A, 14),
    '--surface-interactive-selected-bg': alpha(A, 24),
    '--control-button-hover-bg': alpha(A, 18),
    '--control-button-active-bg': alpha(A, 28),
    '--brand-primary': A,
    '--brand-secondary': `color-mix(in srgb, ${A} 80%, black)`,
    '--brand-primary-light': `color-mix(in srgb, ${A} 55%, white)`,
    '--brand-tint': `color-mix(in srgb, ${A} 36%, ${B})`,
    '--brand-tint-hover': `color-mix(in srgb, ${A} 48%, ${B})`,
    '--brand-tint-border': A,
    '--text-on-brand-primary': onBrand,
    '--text-link': spec.link ?? `color-mix(in srgb, ${A} 60%, white)`,
    '--scrollbar-thumb-bg': alpha(A, 55),
    '--scrollbar-thumb-bg-hover': alpha(A, 80),
  };
  v['--text-primary'] = text;
  v['--text-chat'] = text;
  v['--text-secondary'] = `color-mix(in srgb, ${text} 88%, ${B})`;
  v['--text-primary-muted'] = `color-mix(in srgb, ${text} 72%, ${B})`;
  v['--text-chat-muted'] = `color-mix(in srgb, ${text} 72%, ${B})`;
  v['--text-tertiary'] = `color-mix(in srgb, ${text} 58%, ${B})`;
  v['--surface-interactive-selected-color'] = text;
  if (spec.radius !== undefined) v['--outline-radius'] = `${spec.radius}px`;
  if (spec.font) v['--font-sans'] = spec.font;

  const lines = [`/* ${spec.name} */`, ':root, :root[class] {'];
  for (const [k, val] of Object.entries(v)) lines.push(`  ${k}: ${val} !important;`);
  lines.push('}');

  // CSS-module class names are hashed as `name__local___hash`, so `[class*="local"]`
  // substring selectors keep matching across builds without needing the exact hash.
  const chatSurface = ['main', '[data-flx="channel.messages.scroller"]',
    '[data-flx="channel.channel-view.channel-view-scaffold.chat-area-slot"]',
    '[class*="messagesArea"]', '[class*="messagesWrapper"]'];
  // Excludes headerContainerBanner: a guild header showing a server banner image sets that
  // extra class and relies on its own background staying transparent so the banner shows.
  // Forcing our background on it (gradient or not) painted over/hid the banner.
  const headerSurface = ['header', '[class*="headerContainer"]:not([class*="headerContainerBanner"])'];
  const memberListSurface = ['aside', '[data-flx="channel.channel-members.member-list-container"]',
    '[data-flx="channel.member-list-container.member-list-scroller"]', '[class*="memberListContainer"]'];
  // The server icon rail and the channel list are two separate elements painted over the
  // same shared grid background, not one panel — both need to be listed to get the gradient
  // across the whole left side rather than just the rail or just the list.
  // Excludes channelListScrollerOverBanner for the same reason headerContainer excludes
  // headerContainerBanner below: that modifier class means a guild banner image is meant to
  // show through this element, via its own background staying transparent.
  const sidebarSurface = ['[class*="guildListScrollerWrapper"]',
    '[class*="channelListScroller"]:not([class*="channelListScrollerOverBanner"])'];

  if (grad) {
    // Paint the gradient directly, opaque, on the real chrome surfaces rather than a
    // page-wide transparent one — see the note at the top of this file for why that
    // doesn't render reliably in this client.
    lines.push('', '/* gradient painted on the chrome surfaces, not relied on to show through others */',
      rule(['.fluxer-native-titlebar', ...headerSurface, ...chatSurface, ...memberListSurface, ...sidebarSurface],
        `  background: ${gradCss} !important;`));
  } else {
    // No gradient: still beat a competing stylesheet's literal selectors with our solid colors.
    lines.push('', '/* solid chrome surfaces, matching selectors a competing stylesheet might use */',
      rule(['.fluxer-native-titlebar'], `  background: ${shade(5)} !important;`),
      rule(headerSurface, `  background: ${shade(9)} !important;`),
      rule(chatSurface, `  background: ${v['--composer-surface-color']} !important;`),
      rule(memberListSurface, `  background: ${shade(8)} !important;`),
      rule(sidebarSurface, `  background: ${shade(5)} !important;`));
  }
  // A banner guild's header and channel-list-scroller backgrounds have to stay transparent
  // regardless of gradient mode, for the same reason: it's what lets the banner image
  // underneath show at all.
  lines.push('', '/* let a guild banner image show through instead of our background */',
    rule(['[class*="headerContainerBanner"]', '[class*="channelListScrollerOverBanner"]'], '  background: transparent !important;'),
    // The scroll-collapse "glass" pane fades in over the banner via its own inline opacity;
    // giving it the full gradient makes that fade look like it's smearing a gradient over the
    // banner, so it stays a plain solid tint (same spirit as the client's own flat default)
    // even when the rest of the theme is a gradient.
    rule(['[class*="headerGlass"]'], `  background: ${shade(9)} !important;`));
  // The composer stays a plain solid box even with a gradient theme (busy text is hard to
  // read over a moving gradient), but still needs to win against a competing stylesheet,
  // including its border/focus ring — a competing stylesheet can set those directly too,
  // bypassing the --floating-surface-ring-color variable the client normally draws them from.
  const composerSurface = ['[class*="composerRoot"]', '[class*="composerBar"]'];
  lines.push('', '/* composer: solid regardless of gradient, legibility over spectacle */',
    rule(composerSurface, `  background: ${shade(11)} !important;\n  border-color: ${alpha(A, 30)} !important;`),
    rule(composerSurface.map((s) => `${s}:focus-within`),
      `  border-color: ${A} !important;\n  box-shadow: 0 0 10px ${alpha(A, 40)} !important;`));

  // These are all var-driven in the client's own CSS (--brand-primary, --background-modifier-selected,
  // --text-secondary), which we already set above — but a competing stylesheet that overrides
  // the *selector* directly (rather than the variable) still wins over a variable reference,
  // so these are matched the same way as the panel backgrounds.
  lines.push('', '/* server icon (no uploaded image), selected channel row, member-list group labels, titlebar controls */',
    // guildIconNoImage: a server with no uploaded icon (shows its initial letter).
    // fluxerButtonIcon: the Home and Favorites circles at the top of the rail (confirmed in
    // GuildsLayout.module.css/FavoritesButton.tsx — a different component from clickableItemIcon
    // below, which is the individual-DM-conversation-row icon).
    rule(['[class*="guildIconNoImage"]', '[class*="fluxerButtonIcon"]', '[class*="clickableItemIcon"]'],
      `  background-color: ${shade(12)} !important; color: ${text} !important;`),
    // Keep Home/Favorites/DM-row icons in the accent color when active, same reasoning as the
    // selected channel item below: the blanket rule above would otherwise flatten the active
    // state to the same color as every other icon.
    rule(['[class*="fluxerButtonIconSelected"]', '[class*="clickableItemSelected"] [class*="clickableItemIcon"]'],
      `  background-color: ${A} !important; color: ${onBrand} !important;`),
    // `background` (not `background-color`): a competing stylesheet may set the selected
    // row's background via the shorthand (gradient image + fallback color together), and
    // overriding only background-color leaves its background-image showing through on top.
    // box-shadow: a competing stylesheet can also draw its own accent-colored left stripe via
    // an inset box-shadow (the client's own CSS doesn't use one at all here), which survives
    // a background override untouched unless matched directly.
    rule(['[class*="channelItemSelected"]', '[class*="channelItemCoreSelected"]'],
      `  background: ${alpha(A, 24)} !important;\n  box-shadow: inset 3px 0 0 ${A} !important;`),
    // groupHeaderLabel is the "ONLINE" text; the separator/count ("— 2") are rendered in
    // separate elements that weren't covered by targeting the label alone.
    rule(['[class*="groupHeaderLabel"]', '[class*="groupHeaderSeparator"]', '[class*="groupHeaderCount"]', '[data-flx*="member-group-header"]'],
      `  color: ${A} !important;`),
    rule(['.fluxer-native-titlebar__control'], `  color: ${text} !important;`),
    // A competing stylesheet's `[class*="titlebar"]` matches every one of these by substring
    // too (they're all literally named "fluxer-native-titlebar__..."), painting its own
    // background on each piece individually rather than just the bar as a whole. None of
    // these are meant to have a visible background of their own in the vanilla design — only
    // the bar itself (set above) is — so they're reset to transparent across the board.
    // :not(:hover):not(:active) leaves the buttons' own highlight-on-hover alone.
    rule([
      '.fluxer-native-titlebar__left', '.fluxer-native-titlebar__wordmark',
      '.fluxer-native-titlebar__spacer', '.fluxer-native-titlebar__controls',
      '.fluxer-native-titlebar__control:not(:hover):not(:active)',
    ], '  background: transparent !important;'));

  lines.push('', '/* accent-colored selection and focus */',
    `::selection { background: ${alpha(A, 45)} !important; }`);
  return lines.join('\n') + '\n';
}

export const SPEC_SCHEMA_DOC = `{
  "name": "short theme name",
  "mode": "dark" | "light",
  "background": "#hex of the main/base surface (dark for dark mode, light for light mode)",
  "gradient": null | { "angle": 0-360, "colors": ["#hex", "#hex", ...2-4 colors] },
  "accent": "#hex used for buttons, highlights, selection, borders (the 'accent color')",
  "text": null | "#hex for body text (null = keep the default)",
  "link": null | "#hex for links",
  "radius": null | 0-32 (corner rounding in px),
  "font": null | "CSS font-family list"
}`;

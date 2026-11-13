// Compiles a small design spec (chosen by the LLM) into a COMPLETE Fluxer stylesheet.
// The model only picks colors/intent; code guarantees every variable is real, derived
// consistently, and that nothing references itself.

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
  const grad = spec.gradient;
  const gradCss = grad && `linear-gradient(${grad.angle}deg, ${grad.colors.join(', ')})`;
  // With a gradient, the big surfaces become translucent so the window-wide gradient shows through.
  const big = (c) => (grad ? alpha(c, 72) : c);

  const onBrand = luminance(A) > 0.5 ? '#111111' : '#ffffff';
  const text = spec.text ?? (dark ? null : '#16161a');

  const v = {
    '--background-primary': big(B),
    '--background-secondary': big(shade(5)),
    '--background-secondary-lighter': shade(8),
    '--background-secondary-alt': shade(11),
    '--background-tertiary': shade(15),
    '--background-channel-header': big(shade(9)),
    '--channel-header-background': big(shade(9)),
    '--guild-list-foreground': big(shade(12)),
    '--background-header-primary': shade(16),
    '--background-header-secondary': shade(16),
    '--background-header-primary-hover': shade(21),
    '--background-textarea': shade(11),
    '--form-surface-background': shade(11),
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
  if (text) {
    v['--text-primary'] = text;
    v['--text-chat'] = text;
    v['--text-secondary'] = `color-mix(in srgb, ${text} 88%, ${B})`;
    v['--text-primary-muted'] = `color-mix(in srgb, ${text} 72%, ${B})`;
    v['--text-chat-muted'] = `color-mix(in srgb, ${text} 72%, ${B})`;
    v['--text-tertiary'] = `color-mix(in srgb, ${text} 58%, ${B})`;
  }
  if (spec.radius !== undefined) v['--outline-radius'] = `${spec.radius}px`;
  if (spec.font) v['--font-sans'] = spec.font;

  const lines = [`/* ${spec.name} */`, ':root, :root[class] {'];
  for (const [k, val] of Object.entries(v)) lines.push(`  ${k}: ${val} !important;`);
  lines.push('}');

  if (grad) {
    lines.push('', '/* one gradient spanning the whole window; translucent panels reveal it */',
      'html, html.allow-transparency, html.allow-transparency body {',
      `  background: ${gradCss} fixed !important;`,
      '}');
  }
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

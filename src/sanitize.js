// LLM output is untrusted. Keep CSS purely presentational: no network fetches
// (tracking pixels, remote @import), no legacy script hooks, no style-tag breakout.

export function extractCss(text) {
  const fenced = text.match(/```(?:css)?\s*\n([\s\S]*?)```/i);
  let css = fenced ? fenced[1] : text;
  // Unterminated fence (truncated output)
  if (!fenced) css = css.replace(/^```(?:css)?\s*\n?/i, '');
  return css.trim();
}

export function sanitizeCss(css) {
  const notes = [];
  let out = css;

  out = out.replace(/<\/?style[^>]*>/gi, () => (notes.push('removed <style> tag'), ''));
  out = out.replace(/@import[^;]*;?/gi, () => (notes.push('removed @import'), ''));
  out = out.replace(/@charset[^;]*;?/gi, '');
  out = out.replace(/url\(\s*(['"]?)\s*(?!data:image\/)(?!#)[^)]*\)/gi, (m) => {
    notes.push('removed external url()');
    return 'none';
  });
  out = out.replace(/expression\s*\(|javascript:|behavior\s*:|-moz-binding/gi, () => (notes.push('removed script hook'), ''));

  // Balanced braces or the whole stylesheet could break the client's CSS.
  let depth = 0;
  for (const ch of out) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) throw new Error('Generated CSS has unbalanced braces');
  }
  if (depth !== 0) throw new Error('Generated CSS has unbalanced braces (output may be truncated)');
  if (!out.trim()) throw new Error('Generated CSS was empty');

  return { css: out.trim() + '\n', notes: [...new Set(notes)] };
}

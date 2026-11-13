import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCss, sanitizeCss } from '../src/sanitize.js';
import { splitMessage } from '../src/fluxer.js';

test('extracts fenced css', () => {
  assert.equal(extractCss('hi\n```css\n:root{--a:1}\n```\nbye'), ':root{--a:1}');
});
test('strips imports and remote urls, keeps data images', () => {
  const { css, notes } = sanitizeCss('@import url(http://x/y.css);\na{background:url(https://evil/p.png)}\nb{background:url(data:image/png;base64,AA)}');
  assert.ok(!css.includes('evil') && !css.includes('@import'));
  assert.ok(css.includes('data:image/png'));
  assert.ok(notes.length >= 2);
});
test('rejects unbalanced braces', () => {
  assert.throws(() => sanitizeCss('a{color:red'));
  assert.throws(() => sanitizeCss('}a{}'));
});
test('rejects empty', () => assert.throws(() => sanitizeCss('   ')));
test('splitMessage respects limit', () => {
  const parts = splitMessage('x\n'.repeat(3000), 1900);
  assert.ok(parts.every((p) => p.length <= 1900));
});

import { cleanSpec, compileTheme } from '../src/theme-compiler.js';
test('compiler: complete, no self references, gradient on html', () => {
  const css = compileTheme(cleanSpec({
    mode: 'dark', background: '0a2412', accent: '#ef4444',
    gradient: { angle: 135, colors: ['#0a2412', '#14532d'] },
  }));
  assert.match(css, /--background-primary:/);
  assert.match(css, /linear-gradient\(135deg/);
  for (const m of css.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
    assert.ok(!new RegExp(`var\\(${m[1]}\\)`).test(m[2]), `${m[1]} references itself`);
  }
});
test('compiler: rejects missing background, fixes bad accent', () => {
  assert.throws(() => cleanSpec({ accent: 'red' }));
  assert.equal(cleanSpec({ background: '#000', accent: 'red' }).accent, '#5865f2');
});

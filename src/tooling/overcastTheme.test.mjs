import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeThemeTokens, themeCssVariables, validThemeId } from '../overcastTheme.js';
import { WORLD_OVERLAY_STYLE, applyWorldOverlayTheme, CARD_PLATE_ALPHA } from '../overlays/worldOverlayTokens.js';

const TACTICAL = { bg: '#1a1510', header: '#120f0a', panel: '#1f1a14', accent: '#f59e0b', accent2: '#d97706', text: '#fef3c7', muted: '#64748b', danger: '#ef4444' };

test('only Overcast theme ids and hex tokens are accepted', () => {
  assert.equal(validThemeId('tactical'), 'tactical');
  assert.equal(validThemeId('<script>'), null);
  assert.equal(sanitizeThemeTokens({ accent: 'red' }), null);
  assert.equal(sanitizeThemeTokens({ ...TACTICAL, accent: 'url(x)' }), null);
  assert.equal(sanitizeThemeTokens(TACTICAL).accent, '#f59e0b');
});

test('a theme sets the variables every stylesheet reads', () => {
  const v = themeCssVariables(sanitizeThemeTokens(TACTICAL));
  assert.equal(v['--accent-rgb'], '245, 158, 11');
  assert.equal(v['--surface-rgb'], '18, 15, 10');
  assert.equal(v['--text-primary'], '#fef3c7');
  assert.equal(v['--bg-dark'], '#1a1510');
});

test('card chrome follows the theme, plate alpha stays as tuned, and resets', () => {
  const before = { ...WORLD_OVERLAY_STYLE };
  applyWorldOverlayTheme(sanitizeThemeTokens(TACTICAL));
  assert.equal(WORLD_OVERLAY_STYLE.accent, 'rgb(245, 158, 11)');
  assert.equal(WORLD_OVERLAY_STYLE.background, `rgba(18, 15, 10, ${CARD_PLATE_ALPHA})`);
  assert.equal(WORLD_OVERLAY_STYLE.title, 'rgba(254, 243, 199, 0.96)');
  applyWorldOverlayTheme(null);
  assert.equal(WORLD_OVERLAY_STYLE.accent, before.accent);
  assert.equal(WORLD_OVERLAY_STYLE.background, before.background);
});

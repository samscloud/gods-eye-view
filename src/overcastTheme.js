/**
 * Overcast themes on the globe.
 *
 * Gary B, 24 Sep 2026: when an organization changes its Overcast theme, the
 * God's-eye globe must change with it. The Command Center sends
 *   postMessage({ type: 'overcast:theme', theme, tokens })
 * and the standalone /globe/?theme=<id> page fetches the same tokens from
 * GET /api/globe/overcast-icons?theme=<id>. Tokens are hex colours:
 * bg, header, panel, accent, accent2, text, muted, success, warning, danger.
 *
 * What changes: the CSS theme variables every stylesheet reads (accent,
 * surfaces, text), the shared world-overlay card chrome, and the Overcast
 * Layers marks (which re-fetch their icons in the new theme).
 */
import { applyWorldOverlayTheme } from './overlays/worldOverlayTokens.js';

const HEX = /^#[0-9a-f]{6}$/i;
const REQUIRED = ['bg', 'header', 'panel', 'accent', 'text'];

/** Theme ids are the Overcast ones; anything else is ignored. Exported for tests. */
export function validThemeId(v) {
  return typeof v === 'string' && /^[a-z][a-z0-9-]{1,31}$/.test(v) ? v : null;
}

/** Keep only well-formed hex tokens; null unless the required ones are present. Exported for tests. */
export function sanitizeThemeTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(tokens)) if (typeof v === 'string' && HEX.test(v)) out[k] = v.toLowerCase();
  return REQUIRED.every((k) => out[k]) ? out : null;
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Blend toward white by t (0..1). */
const lighten = (c, t) => c.map((v) => Math.round(v + (255 - v) * t));

/** CSS variable values for a token set. Pure; exported for tests. */
export function themeCssVariables(tokens) {
  const a = rgb(tokens.accent);
  const t = rgb(tokens.text);
  const p = rgb(tokens.panel);
  const h = rgb(tokens.header);
  const list = (c) => c.join(', ');
  return {
    '--accent-rgb': list(a),
    '--accent-bright-rgb': list(lighten(a, 0.72)),
    '--surface-rgb': list(h),
    '--bg-dark': tokens.bg,
    '--glass-bg': `rgba(${list(p)}, 0.72)`,
    '--text-primary': tokens.text,
    '--text-secondary': `rgba(${list(t)}, 0.5)`,
    '--text-dim': `rgba(${list(t)}, 0.3)`,
  };
}

let current = null;

export function currentOvercastTheme() {
  return current;
}

/**
 * Apply a theme to the whole globe page. Safe to call repeatedly.
 * @param {string} theme Theme id.
 * @param {object} tokens Hex tokens.
 * @param {{viewer?: object}} [opts]
 * @returns {boolean} Whether the theme was applied.
 */
export function applyOvercastTheme(theme, tokens, { viewer } = {}) {
  const id = validThemeId(theme);
  const clean = sanitizeThemeTokens(tokens);
  if (!id || !clean) return false;
  const root = globalThis.document?.documentElement;
  if (root) {
    for (const [k, v] of Object.entries(themeCssVariables(clean))) root.style.setProperty(k, v);
    root.dataset.overcastTheme = id;
  }
  applyWorldOverlayTheme(clean);
  current = { theme: id, tokens: clean };
  globalThis.dispatchEvent?.(new CustomEvent('overcast:theme-applied', { detail: current }));
  viewer?.scene?.requestRender?.();
  return true;
}

/** Standalone page: /globe/?theme=<id>. */
export async function applyThemeFromLocation({ viewer, fetchImpl = globalThis.fetch } = {}) {
  let id = null;
  try {
    id = validThemeId(new URLSearchParams(globalThis.location?.search || '').get('theme'));
  } catch {
    return false;
  }
  if (!id || typeof fetchImpl !== 'function') return false;
  try {
    const res = await fetchImpl(`/api/globe/overcast-icons?theme=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    if (!res.ok) return false;
    const body = await res.json();
    return applyOvercastTheme(body?.theme || id, body?.tokens, { viewer });
  } catch {
    return false;
  }
}

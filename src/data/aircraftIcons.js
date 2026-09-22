// src/data/aircraftIcons.js
/**
 * Nose-up white aircraft silhouettes, one per classifyAircraft() kind, as SVG
 * data URIs for Cesium billboards.
 *
 * FIDELITY NOTE (2026-07-02): redrawn at a 96×96 viewBox (glyph centered at
 * 48,48) instead of the old 32×32. The billboards themselves are still added at
 * width/height 20 (24 tracked) in flights.js / militaryFlights.js, so Cesium
 * DOWN-samples this larger, higher-precision source to the same on-screen
 * footprint — crisp anti-aliased edges instead of an upscaled 32px bitmap. The
 * on-screen size is unchanged and CLASS_SCALE_2D is untouched (no scale
 * compensation needed: the billboard's explicit width/height, not the SVG's,
 * sets the pixel size — the intrinsic SVG size only controls raster fidelity).
 *
 * All glyphs are nose-up (nose toward -Y at rotation 0; the screen-projected
 * rotation pipeline in iconOrientation.js spins the whole glyph). Fill is white
 * with a subtle dark hairline stroke so the tint pipeline (billboard.color =
 * white / cyan-tracked / amber-military, plus .withAlpha fades) keeps working —
 * no per-glyph hardcoded colors that would fight the tint.
 *
 * MIXED-SET UPDATE (2026-08-15, owner Hangar picks): airliner/widebody/
 * turboprop/helicopter use the "refined" recognition-chart redraw;
 * quadjet/glider use the "bold" chart-symbol redraw; light/fastjet keep the
 * original drawings. Raster fidelity doubled (192px source, same 96 coords).
 *
 * Silhouette language follows skylight's type-aware glyphs (MIT,
 * https://github.com/cpaczek/skylight): slender fuselages, swept wings for
 * jets, long high-aspect wings for the glider, straight wings + prop discs for
 * props, a rotor disc + tail boom + tail-rotor for the helicopter, and a delta
 * for the fast jet. Each class has a DISTINCT planform so it reads at ~20px by
 * shape, not just by footprint size.
 */

const VIEW = 96;
const C = VIEW / 2; // 48 — glyph centre

// Hairline dark edge (scaled for the 96 box: ~1.5u ≈ the old 0.5u at 32).
const STROKE =
  'stroke="rgba(0,0,0,0.32)" stroke-width="1.4" stroke-linejoin="round"';
// Heavier edge for the chart-symbol ("bold") glyphs adopted 2026-08-15.
const STROKE_BOLD =
  'stroke="rgba(0,0,0,0.38)" stroke-width="2" stroke-linejoin="round"';
// Softer white for translucent detail (prop discs, rotor disc) — still white so
// the tint multiplies cleanly; only the alpha differs.
const DISC = 'fill="white" fill-opacity="0.5"';

// Each body is drawn in a centred coordinate frame (origin 0,0 = glyph centre),
// nose toward -Y. Numbers are in the 96-unit space (half-extent up to ~45).
/* Overcast icon set (client/src/lib/globeIcons.ts in SamscloudOvercast),
 * drawn in a 64 box; scaled 1.45x into this 96 box. White fill so the
 * layers' colour tint applies. tr3b/tr3bHot fall back to "unknown". */
const OVERCAST_SCALE = 'transform="scale(1.45)"';
const ov = (d) => `<path d="${d}" fill="white" fill-rule="evenodd" ${STROKE} ${OVERCAST_SCALE}/>`;
const BODIES = {
  airliner: ov('M0,-24 C2.6,-22 3.2,-17 3.2,-10 L3.2,-3 L24,6 L24,10 L3.2,5 L3.2,15 L9,20 L9,23 L0,21 L-9,23 L-9,20 L-3.2,15 L-3.2,5 L-24,10 L-24,6 L-3.2,-3 L-3.2,-10 C-3.2,-17 -2.6,-22 0,-24 Z'),
  widebody: ov('M0,-26 C3.8,-24 4.8,-18 4.8,-10 L4.8,-4 L28,7 L28,11.5 L4.8,6 L4.8,16 L11,21 L11,24.5 L0,22 L-11,24.5 L-11,21 L-4.8,16 L-4.8,6 L-28,11.5 L-28,7 L-4.8,-4 L-4.8,-10 C-4.8,-18 -3.8,-24 0,-26 Z'),
  quadjet: ov('M0,-27 C4,-25 5,-19 5,-10 L5,-4 L30,8 L30,12.5 L5,7 L5,17 L12,22 L12,25.5 L0,23 L-12,25.5 L-12,22 L-5,17 L-5,7 L-30,12.5 L-30,8 L-5,-4 L-5,-10 C-5,-19 -4,-25 0,-27 Z M11,3 h3 v9 h-3 Z M19,6 h3 v8 h-3 Z M-14,3 h3 v9 h-3 Z M-22,6 h3 v8 h-3 Z'),
  turboprop: ov('M0,-22 C2.4,-20 3,-16 3,-10 L3,-4 L24,-1 L24,3 L3,4 L3,14 L8,18 L8,21 L0,19 L-8,21 L-8,20 L-3,14 L-3,4 L-24,3 L-24,-1 L-3,-4 L-3,-10 C-3,-16 -2.4,-20 0,-22 Z M13,-5 a3.2,3.2 0 1,0 0.01,0 Z M-13,-5 a3.2,3.2 0 1,0 0.01,0 Z'),
  light: ov('M0,-18 C2,-16.5 2.4,-13 2.4,-8 L2.4,-6 L22,-4 L22,-0.5 L2.4,1 L2.4,11 L7,14 L7,16.5 L0,15 L-7,16.5 L-7,14 L-2.4,11 L-2.4,1 L-22,-0.5 L-22,-4 L-2.4,-6 L-2.4,-8 C-2.4,-13 -2,-16.5 0,-18 Z M0,-21 a3,3 0 1,0 0.01,0 Z'),
  glider: ov('M0,-16 C1.4,-15 1.8,-12 1.8,-8 L1.8,-3 L32,-2 L32,0.5 L1.8,1 L1.8,14 L6,16 L6,18 L0,17 L-6,18 L-6,16 L-1.8,14 L-1.8,1 L-32,0.5 L-32,-2 L-1.8,-3 L-1.8,-8 C-1.8,-12 -1.4,-15 0,-16 Z'),
  helicopter: ov('M0,-16 C5,-16 8,-11 8,-5 C8,1 5,5 0,6 C-5,5 -8,1 -8,-5 C-8,-11 -5,-16 0,-16 Z M-1.8,5 L1.8,5 L1.2,22 L-1.2,22 Z M-6,19 L6,19 L6,21.6 L-6,21.6 Z M-24,-6 L24,-6 L24,-3.6 L-24,-3.6 Z M-3.6,-27 L3.6,-27 L3.6,17 L-3.6,17 Z'),
  fastjet: ov('M0,-27 L2.2,-14 L2.2,-4 L20,10 L20,13.5 L2.6,9 L2.6,14 L8,20 L8,22.5 L0,20.5 L-8,22.5 L-8,20 L-2.6,14 L-2.6,9 L-20,13.5 L-20,10 L-2.2,-4 L-2.2,-14 Z'),
  bizjet: ov('M0,-23 C2,-21.5 2.6,-17 2.6,-11 L2.6,0 L19,10 L19,13 L2.6,8 L2.6,15 L10,17 L10,19.5 L0,18 L-10,19.5 L-10,17 L-2.6,15 L-2.6,8 L-19,13 L-19,10 L-2.6,0 L-2.6,-11 C-2.6,-17 -2,-21.5 0,-23 Z M-7,20 L7,20 L7,22.4 L-7,22.4 Z'),
  uav: ov('M0,-14 C3,-14 4,-11 4,-7 L4,-2 L30,-0.5 L30,2.5 L4,2 L4,12 L10,18 L10,20.5 L0,17 L-10,20.5 L-10,18 L-4,12 L-4,2 L-30,2.5 L-30,-0.5 L-4,-2 L-4,-7 C-4,-11 -3,-14 0,-14 Z'),
  unknown: ov('M0,-18 L14,14 L0,7 L-14,14 Z'),
  tr3b: ov('M0,-18 L14,14 L0,7 L-14,14 Z'),
  tr3bHot: ov('M0,-18 L14,14 L0,7 L-14,14 Z'),
};

const _iconCache = new Map();

const _b64 = (s) =>
  typeof btoa === 'function'
    ? btoa(s)
    : Buffer.from(s, 'utf8').toString('base64');

/** Fleet raster: billboards render at ~40–58 DEVICE px (width 20–24 CSS ×
 *  Retina × class scale). Cesium's billboard atlas has no mipmaps, so a big
 *  texture gets GPU-minified into mush (192 px ÷ 40 = 4.8× — the owner's
 *  "soft" glyphs; the pre-2026-08-15 96 px raster aliased instead). Rastering
 *  NEAR the display size lets the browser's SVG AA do the work: crisp AND
 *  smooth. 64 covers the 40–58 px fleet band with ≤1.6× minification. */
const FLEET_RASTER_PX = 64;
/** Tracked raster: the tracked billboard is the one SUSTAINED large 2D glyph
 *  (close-zoom fleet flybys hand off to 3D models). Keep the 192 px texture so
 *  it stays crisp at its biggest on-screen sizes. */
const TRACKED_RASTER_PX = 192;

/** Data URI for a class silhouette (lazily built, cached per kind+size).
 *  Default size serves the fleet; pass `aircraftIcon(kind, TRACKED_ICON_PX)`
 *  (re-exported below) for the tracked billboard. */
export const TRACKED_ICON_PX = TRACKED_RASTER_PX;
export function aircraftIcon(kind, px = FLEET_RASTER_PX) {
  const k = BODIES[kind] ? kind : 'airliner';
  const key = `${k}@${px}`;
  let uri = _iconCache.get(key);
  if (!uri) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${VIEW} ${VIEW}"><g transform="translate(${C},${C})">${BODIES[k]}</g></svg>`;
    uri = 'data:image/svg+xml;base64,' + _b64(svg);
    _iconCache.set(key, uri);
  }
  return uri;
}

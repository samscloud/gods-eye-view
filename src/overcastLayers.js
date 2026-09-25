/**
 * Overcast layers on the globe.
 *
 * The Command Center's ~100 data layers (FEMA, GDACS, NWS, conflicts, bases,
 * outbreaks, launches…) live on the Overcast server, in one shared store
 * that every account reads (server/layerStore.ts). This globe layer draws
 * whichever of them the host asks for, from that same store:
 *
 *   GET /api/trpc/osint.layers.getData { layerId }
 *
 * The host (the Command Center's map panel) sends the list with
 *   postMessage({ type: 'overcast:layers', layers: [...ids] })
 * and the standalone /globe/ page reads ?layers=a,b,c. Nothing here fetches a
 * provider directly; a layer the server reports as unavailable is listed with
 * its reason and draws nothing.
 *
 * Presentation follows the globe's own layers (Gary B, 24 Sep 2026: "it
 * needs to match what they've already done"): each item is a billboard mark
 * from the Overcast icon set (GET /api/globe/overcast-icons), ambient
 * tactical cards with a title and a detail line through the shared world
 * overlay (as FIRMS and vessels do), and a click selects it into the shared
 * context store so the tracked readout card and the context panel show it
 * like any native contact. No private DOM card.
 */
import * as Cesium from 'cesium';
import {
  clearSelectedEntityContextForLayer,
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from './data/contextStore.js';
import { isPointerFree } from './data/inputOwnership.js';
import { currentOvercastTheme } from './overcastTheme.js';
import { describeOvercastPoint, sanitizeAttributes } from './overcastFacts.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  getWorldOverlayDiagnostics,
  setOverlaySourceVisible,
} from './overlays/worldOverlay.js';

export const OVERCAST_LAYERS_ID = 'overcast-layers';
const ID_GRAMMAR = /^[a-z0-9-]{1,48}$/;
const MAX_LAYERS = 40;
const MAX_ROWS_PER_LAYER = 2000;

const SEVERITY_COLOR = Object.freeze({
  critical: '#ff4d5e',
  high: '#ff9a3c',
  medium: '#ffd24a',
  low: '#4fd1c5',
});

/** Distinct outline per layer id, stable across reloads. */
const PALETTE = ['#5aa9ff', '#c084fc', '#34d399', '#f472b6', '#facc15', '#22d3ee', '#fb923c', '#a3e635', '#e879f9', '#60a5fa'];
export function layerAccent(layerId) {
  let h = 0;
  for (const ch of String(layerId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Keep only well-formed ids, deduped, capped. */
export function sanitizeLayerIds(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const id = String(raw ?? '').trim();
    if (ID_GRAMMAR.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_LAYERS) break;
  }
  return out;
}

/** One getData row → a drawable point, or null without a real position. */
export function rowToPoint(layerId, row) {
  const lat = row?.geo?.lat;
  const lon = row?.geo?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const a = row.attributes || {};
  const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.trim())?.trim();
  const label = pick(a.name, a.title, a.headline, a.event, a.callsign, a.description) || row.event_type || layerId;
  const severity = SEVERITY_COLOR[row?.severity?.label] ? row.severity.label : 'medium';
  return {
    id: `${layerId}:${String(row.event_id ?? `${lat},${lon}`)}`,
    layerId,
    lat,
    lon,
    label: String(label).slice(0, 140),
    severity,
    source: row?.source?.provider_name || '',
    url: typeof row?.source?.item_url === 'string' && /^https?:\/\//.test(row.source.item_url) ? row.source.item_url : '',
    time: typeof row.start_ts === 'string' ? row.start_ts : '',
    reference: a.reference === true,
    kind: typeof row.event_type === 'string' ? row.event_type : '',
    ends: typeof row.end_ts === 'string' ? row.end_ts : '',
    attrs: sanitizeAttributes(a),
  };
}

const SEVERITY_RANK = Object.freeze({ critical: 3, high: 2, medium: 1, low: 0 });

/**
 * One point per id. Feeds can repeat an event id (OpenFEMA lists one
 * declaration per designated area under the same id), and a repeated entity
 * id makes Cesium throw, which failed the whole layer on production
 * (24 Sep 2026: "An entity with id fema-disasters:fema-5676 already exists").
 * The first row wins. Exported for tests.
 */
export function dedupePoints(points) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
const AMBIENT_COHORT = 30;
const AMBIENT_CANDIDATES = 600;
const AMBIENT_FADE_M = 2_500_000;
/*
 * Gary B, 24 Sep 2026: from the whole-globe view no detail tags showed at
 * all, because every card faded out 2,500 km from the camera and the globe
 * view sits ~10,000-20,000 km out. Critical and high items now keep their
 * card from the globe view down; the rest still appear as you zoom in. The
 * cohort limit (AMBIENT_COHORT) and collision capacity keep it uncluttered,
 * and horizon culling hides the far side.
 */
const CARD_DISTANCE_BY_SEVERITY = Object.freeze({ critical: 40_000_000, high: 40_000_000 });

/** How far from the camera an item's detail card stays visible. Exported for tests. */
export function cardMaxDistance(severity) {
  return CARD_DISTANCE_BY_SEVERITY[severity] ?? AMBIENT_FADE_M;
}

/** Short age from an ISO time: "12m", "5h", "3d"; '' when unknown. Exported for tests. */
export function formatAge(iso, nowMs = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((nowMs - t) / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

const trim = (text, max) => {
  const s = String(text || '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * Ambient card (title + one detail line) and selected/tracked model (title +
 * full details), in the same shape the FIRMS and vessel cards use. Pure;
 * exported for tests.
 * @param {object} p Point from rowToPoint.
 * @param {{name?: string, accent?: string}} style Layer style from the icon endpoint.
 * @param {number} [nowMs]
 */
export function overcastCardModel(p, style = {}, nowMs = Date.now()) {
  const layerName = String(style.name || p.layerId.replace(/-/g, ' ')).toUpperCase();
  const age = p.reference ? 'REFERENCE' : formatAge(p.time, nowMs);
  const sev = p.severity === 'critical' || p.severity === 'high' ? p.severity.toUpperCase() : '';
  const when = p.reference
    ? 'reference table'
    : p.time
      ? `${p.time.replace('T', ' ').slice(0, 16)} UTC`
      : 'time not reported';
  // Specific facts from the row (area, expiry, alert level, depth, wind…).
  const d = describeOvercastPoint(p, nowMs);
  const meta = [layerName, sev, age].filter(Boolean).join(' · ');
  return {
    ambient: {
      title: trim(d.title || p.label, 34),
      details: [d.facts[0] ? trim(d.facts[0], 44) : '', meta].filter(Boolean),
    },
    selected: {
      title: trim(d.title || p.label, 48),
      details: [
        [layerName, sev].filter(Boolean).join(' · '),
        ...d.facts.map((line) => trim(line, 56)),
        d.summary ? trim(d.summary, 96) : '',
        [p.source, when].filter(Boolean).join(' · '),
        `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`,
      ].filter(Boolean),
    },
    accent: style.accent || hexTriplet(layerAccent(p.layerId)),
  };
}

const badgeCache = new Map();
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A cluster count as a small badge: a dark disc in the theme's surface
 * colour, a thin accent ring and the count in the theme's text colour, the
 * same language as the Overcast markers. "99+" past two digits. Pure apart
 * from the cache; exported for tests.
 */
export function clusterBadgeDataUrl(count, tokens = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const text = n > 99 ? '99+' : String(n);
  const pick = (v, d) => (typeof v === 'string' && HEX.test(v) ? v : d);
  const fill = pick(tokens.header, '#060810');
  const ring = pick(tokens.accent, '#60a5fa');
  const ink = pick(tokens.text, '#e2e8f0');
  const key = `${text}|${fill}|${ring}|${ink}`;
  let url = badgeCache.get(key);
  if (!url) {
    const size = text.length > 2 ? 9.5 : 11;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 26 26"><circle cx="13" cy="13" r="11.5" fill="${fill}" fill-opacity="0.88" stroke="${ring}" stroke-width="1.5"/><circle cx="13" cy="13" r="9" fill="none" stroke="${ring}" stroke-opacity="0.35" stroke-width="0.75"/><text x="13" y="13" dy="0.36em" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, Menlo, monospace" font-size="${size}" font-weight="600" fill="${ink}">${text}</text></svg>`;
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    badgeCache.set(key, url);
  }
  return url;
}

function hexTriplet(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

async function fetchStyles(theme) {
  const q = theme ? `?theme=${encodeURIComponent(theme)}` : '';
  const res = await fetch(`/api/globe/overcast-icons${q}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return body?.layers && typeof body.layers === 'object' ? body.layers : {};
}

async function fetchLayer(layerId, signal) {
  const input = encodeURIComponent(JSON.stringify({ 0: { json: { layerId } } }));
  const res = await fetch(`/api/trpc/osint.layers.getData?batch=1&input=${input}`, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const data = body?.[0]?.result?.data?.json;
  if (!data) throw new Error(body?.[0]?.error?.json?.message || 'no answer');
  return data;
}

export function createOvercastLayersLayer({ fetchImpl = fetchLayer, fetchStylesImpl = fetchStyles } = {}) {
  let viewer = null;
  let ds = null;
  let enabled = false;
  let wanted = [];
  let request = null;
  let handler = null;
  let styles = null;
  let stylesTheme = null;
  let stylesLoad = null;
  let onTheme = null;
  let selectedId = null;
  let removeCameraListener = null;
  const perLayer = new Map(); // id -> { count, kind, error, asOf }
  const points = new Map(); // entity id -> point
  let lastUpdate = null;
  let lastError = null;

  /** Marks and card accents in the active Overcast theme (re-fetched when it changes). */
  function loadStyles() {
    const theme = currentOvercastTheme()?.theme ?? null;
    if (styles && stylesTheme === theme) return Promise.resolve(styles);
    stylesLoad ??= fetchStylesImpl(theme)
      .then((s) => {
        styles = s;
        stylesTheme = theme;
        return s;
      })
      .catch(() => (styles = {})) // marks fall back to accent dots; cards still work
      .finally(() => (stylesLoad = null));
    return stylesLoad;
  }

  const styleFor = (layerId) => styles?.[layerId] || {};

  /** Critical items take the theme's danger colour on their card; the rest the theme accent. */
  function accentFor(p, m) {
    const danger = currentOvercastTheme()?.tokens?.danger;
    return p.severity === 'critical' && danger ? hexTriplet(danger) : m.accent;
  }

  function iconFor(p) {
    const s = styleFor(p.layerId);
    if (p.severity === 'critical') return s.iconCritical || s.icon;
    if (p.severity === 'high') return s.iconHigh || s.icon;
    return s.icon;
  }

  /** Ambient cards through the shared world overlay, like FIRMS and vessels. */
  let lastPublished = null;
  // Read-only diagnostics for production support (Overcast, 24 Sep 2026: the
  // detail cards did not appear and the overlay's own facade is dev-only).
  globalThis.__overcastLayersDiagnostics = () => ({
    enabled,
    points: points.size,
    lastPublished,
    overlay: getWorldOverlayDiagnostics(),
  });

  function publishCards() {
    if (!enabled) return;
    const now = Date.now();
    const ranked = [...points.values()]
      .filter((p) => p.id !== selectedId)
      .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
      .slice(0, AMBIENT_CANDIDATES);
    const entries = ranked.map((p) => {
      const m = overcastCardModel(p, styleFor(p.layerId), now);
      return {
        id: `overcast:${p.id}`,
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        variant: 'card',
        cardStyle: 'tactical',
        collisionGroup: 'ambient-card',
        title: m.ambient.title,
        details: m.ambient.details,
        accent: accentFor(p, m),
        priority: (SEVERITY_RANK[p.severity] ?? 0) * 10,
        gapPx: 16,
        leaderOffsetPx: 10,
        verticalOnly: true,
        viewportMargin: 4,
        maxDistance: cardMaxDistance(p.severity),
        distanceFadeStartRatio: 0.7,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        interactive: true,
        accessibilityLabel: `Select ${m.ambient.title}, ${m.ambient.details.join(', ')}`,
        activate: () => select(p.id),
      };
    });
    setOverlayEntries(OVERCAST_LAYERS_ID, entries, { cohortLimit: AMBIENT_COHORT, collisionCapacity: AMBIENT_COHORT, moving: false });
    setOverlaySourceVisible(OVERCAST_LAYERS_ID, true);
    lastPublished = { at: Date.now(), count: entries.length };
  }

  function select(id) {
    const entity = ds?.entities.getById(id);
    if (!entity) return false;
    selectedId = id;
    selectEntityContext(entity); // tracked readout card + context panel, as native layers
    publishCards();
    viewer?.scene?.requestRender?.();
    return true;
  }

  function deselect() {
    if (!selectedId) return;
    selectedId = null;
    clearSelectedEntityContextForLayer(OVERCAST_LAYERS_ID);
    publishCards();
  }

  function draw(allPoints) {
    const now = Date.now();
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    removeEntityContextsForLayer(OVERCAST_LAYERS_ID, selectedId ? { retainIds: new Set([selectedId]) } : undefined);
    points.clear();
    for (const p of allPoints) {
      points.set(p.id, p);
      const style = styleFor(p.layerId);
      const icon = iconFor(p);
      const position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat);
      const entity = ds.entities.add({
        id: p.id,
        position,
        billboard: icon
          ? {
              image: icon,
              width: p.severity === 'critical' ? 30 : 26,
              height: p.severity === 'critical' ? 30 : 26,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          : undefined,
        point: icon
          ? undefined
          : {
              pixelSize: 9,
              color: Cesium.Color.fromCssColorString(layerAccent(p.layerId)),
              outlineColor: Cesium.Color.fromCssColorString('#0a0f1a'),
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
      });
      const m = overcastCardModel(p, style, now);
      entity.gevTrackedId = `overcast-layers:${p.id}`;
      entity.gevDisplayPosition = () => position;
      entity.gevLabelModel = { title: m.selected.title, details: m.selected.details, accent: accentFor(p, m), cardStyle: 'tactical' };
      registerEntityContext(entity, {
        id: p.id,
        layerId: OVERCAST_LAYERS_ID,
        layerName: style.name ? `Overcast · ${style.name}` : 'Overcast Layers',
        source: p.source || 'Overcast',
        label: p.label,
        latitude: p.lat,
        longitude: p.lon,
        properties: {
          overcastLayer: p.layerId,
          severity: p.severity,
          time: p.time || null,
          reference: p.reference,
          url: p.url || null,
        },
      });
    }
    ds.entities.resumeEvents();
    if (selectedId && !points.has(selectedId)) deselect();
    publishCards();
    viewer?.scene?.requestRender?.();
  }

  const layer = {
    id: OVERCAST_LAYERS_ID,
    name: 'Overcast Layers',
    icon: '◎',
    source: 'Overcast',
    updateInterval: 60_000,

    init(v) {
      viewer = v;
      ds = new Cesium.CustomDataSource(OVERCAST_LAYERS_ID);
      ds.show = false;
      ds.clustering.enabled = true;
      ds.clustering.pixelRange = 24;
      ds.clustering.minimumClusterSize = 5;
      // Cesium's default cluster is a large bare white number floating on
      // the map (Gary B, 25 Sep 2026: "I don't agree with these numbers").
      // Draw a small count badge in the Overcast marker style instead.
      ds.clustering.clusterEvent.addEventListener((clustered, cluster) => {
        cluster.label.show = false;
        cluster.point.show = false;
        cluster.billboard.show = true;
        cluster.billboard.image = clusterBadgeDataUrl(clustered.length, currentOvercastTheme()?.tokens);
        cluster.billboard.verticalOrigin = Cesium.VerticalOrigin.CENTER;
        cluster.billboard.horizontalOrigin = Cesium.HorizontalOrigin.CENTER;
        cluster.billboard.width = 26;
        cluster.billboard.height = 26;
        cluster.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
      });
      v.dataSources.add(ds);
    },

    enable() {
      enabled = true;
      if (ds) ds.show = true;
      void loadStyles();
      if (!handler && viewer) {
        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((click) => {
          if (!isPointerFree()) return; // a tool owns the pointer
          const picked = viewer.scene.pick(click.position);
          const id = typeof picked?.id?.id === 'string' ? picked.id.id : null;
          if (id && points.has(id)) {
            if (id === selectedId) deselect();
            else select(id);
          } else if (selectedId) {
            deselect();
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
      if (!removeCameraListener && viewer?.camera?.moveEnd) {
        removeCameraListener = viewer.camera.moveEnd.addEventListener(() => publishCards());
      }
      if (!onTheme) {
        onTheme = () => {
          if (!enabled) return;
          styles = null;
          void loadStyles().then(() => draw([...points.values()]));
        };
        globalThis.addEventListener?.('overcast:theme-applied', onTheme);
      }
      publishCards();
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      if (ds) ds.show = false;
      handler?.destroy();
      handler = null;
      removeCameraListener?.();
      removeCameraListener = null;
      if (onTheme) globalThis.removeEventListener?.('overcast:theme-applied', onTheme);
      onTheme = null;
      deselect();
      clearOverlaySource(OVERCAST_LAYERS_ID);
      setOverlaySourceVisible(OVERCAST_LAYERS_ID, false);
    },

    /** Which Overcast layers to draw. Returns the accepted ids. */
    setOvercastLayers(list) {
      wanted = sanitizeLayerIds(list);
      for (const id of [...perLayer.keys()]) if (!wanted.includes(id)) perLayer.delete(id);
      if (enabled) void layer.update(viewer);
      return wanted;
    },

    getOvercastLayers() {
      return [...wanted];
    },

    async update() {
      if (!enabled || !ds) return false;
      request?.abort();
      const ctl = new AbortController();
      request = ctl;
      const [results] = await Promise.all([
        Promise.allSettled(wanted.map((id) => fetchImpl(id, ctl.signal))),
        loadStyles(),
      ]);
      if (ctl.signal.aborted || request !== ctl) return false;
      const all = [];
      results.forEach((r, i) => {
        const id = wanted[i];
        if (r.status === 'rejected') {
          perLayer.set(id, { count: 0, kind: 'unavailable', error: r.reason?.message || String(r.reason), asOf: null });
          return;
        }
        const data = r.value;
        const rows = Array.isArray(data?.events) ? data.events.slice(0, MAX_ROWS_PER_LAYER) : [];
        const pts = dedupePoints(rows.map((row) => rowToPoint(id, row)).filter(Boolean));
        all.push(...pts);
        perLayer.set(id, {
          count: pts.length,
          kind: data?.status?.kind || 'unknown',
          error: data?.status?.error || (rows.length > 0 && pts.length === 0 ? 'rows have no map position' : null),
          asOf: data?.status?.asOf || null,
        });
      });
      draw(all);
      lastUpdate = Date.now();
      lastError = [...perLayer.values()].every((s) => s.kind === 'unavailable') && wanted.length ? 'every requested layer is unavailable' : null;
      request = null;
      return true;
    },

    destroy(v = viewer) {
      layer.disable();
      removeEntityContextsForLayer(OVERCAST_LAYERS_ID);
      if (ds && v) v.dataSources.remove(ds, true);
      ds = null;
      viewer = null;
      points.clear();
      perLayer.clear();
    },

    getStats() {
      let count = 0;
      for (const s of perLayer.values()) count += s.count;
      return { count, lastUpdate, error: lastError, layers: Object.fromEntries(perLayer) };
    },
  };
  return layer;
}

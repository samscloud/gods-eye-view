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
 */
import * as Cesium from 'cesium';

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
  };
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

export function createOvercastLayersLayer({ fetchImpl = fetchLayer } = {}) {
  let viewer = null;
  let ds = null;
  let enabled = false;
  let wanted = [];
  let request = null;
  let handler = null;
  let card = null;
  const perLayer = new Map(); // id -> { count, kind, error, asOf }
  const points = new Map(); // entity id -> point
  let lastUpdate = null;
  let lastError = null;

  function closeCard() {
    card?.remove();
    card = null;
  }

  function showCard(p, screen) {
    closeCard();
    card = document.createElement('div');
    card.className = 'overcast-layer-card';
    const title = document.createElement('div');
    title.className = 'overcast-layer-card__title';
    title.textContent = p.label;
    const meta = document.createElement('div');
    meta.className = 'overcast-layer-card__meta';
    const when = p.time && !p.reference ? `${p.time.replace('T', ' ').slice(0, 16)} UTC` : p.reference ? 'reference table' : '';
    meta.textContent = [p.layerId.toUpperCase().replace(/-/g, ' '), p.source, when].filter(Boolean).join(' · ');
    card.append(title, meta);
    if (p.url) {
      const a = document.createElement('a');
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = 'Source ↗';
      a.className = 'overcast-layer-card__link';
      card.append(a);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'overcast-layer-card__close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', closeCard);
    card.append(close);
    card.style.left = `${Math.round(screen.x + 12)}px`;
    card.style.top = `${Math.round(screen.y + 12)}px`;
    viewer.container.append(card);
  }

  function draw(allPoints) {
    ds.entities.suspendEvents();
    ds.entities.removeAll();
    points.clear();
    for (const p of allPoints) {
      points.set(p.id, p);
      ds.entities.add({
        id: p.id,
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: {
          pixelSize: p.severity === 'critical' ? 11 : p.severity === 'high' ? 9 : 7,
          color: Cesium.Color.fromCssColorString(SEVERITY_COLOR[p.severity]).withAlpha(0.92),
          outlineColor: Cesium.Color.fromCssColorString(layerAccent(p.layerId)),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: p.label.length > 48 ? `${p.label.slice(0, 47)}…` : p.label,
          font: '11px "Roboto Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString('#e5ebf3'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(10, -10),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          // Names only when close enough to read them without clutter.
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_500_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    ds.entities.resumeEvents();
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
      ds.clustering.pixelRange = 28;
      ds.clustering.minimumClusterSize = 4;
      v.dataSources.add(ds);
    },

    enable() {
      enabled = true;
      if (ds) ds.show = true;
      if (!handler && viewer) {
        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((click) => {
          const picked = viewer.scene.pick(click.position);
          const id = picked?.id?.id;
          const p = typeof id === 'string' ? points.get(id) : null;
          if (p) showCard(p, click.position);
          else closeCard();
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      }
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      if (ds) ds.show = false;
      handler?.destroy();
      handler = null;
      closeCard();
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
      const results = await Promise.allSettled(wanted.map((id) => fetchImpl(id, ctl.signal)));
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
        const pts = rows.map((row) => rowToPoint(id, row)).filter(Boolean);
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

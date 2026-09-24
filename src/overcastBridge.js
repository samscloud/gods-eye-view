/**
 * Overcast host bridge. When the globe runs inside the Command Center's map
 * panel (a same-origin iframe), the host drives it with postMessage:
 *
 *   { type: 'overcast:flyTo', lat, lon, heightM? }
 *   { type: 'overcast:layers', layers: [...Command Center layer ids] }
 *
 * Layers: the globe's own live layers take the ids they cover (flights,
 * military air, AIS vessels, cameras — the fork's feeds, which Overcast
 * serves); every other id is drawn by the Overcast Layers layer from the
 * server's shared layer store. The standalone /globe/ page accepts the same
 * list as ?layers=a,b,c.
 *
 * The move goes through the globe's own flyToLandmark, so the render governor
 * and camera-motion ownership apply exactly as for an in-globe fly-to. Only
 * messages from our own origin are accepted.
 */
import { flyToLandmark } from './locations.js';
import { interruptCameraMotion, activeCameraMotionId } from './cameraVerbs.js';
import { OVERCAST_LAYERS_ID, sanitizeLayerIds } from './overcastLayers.js';

export function validFlyTo(data) {
  if (!data || data.type !== 'overcast:flyTo') return null;
  const lat = Number(data.lat);
  const lon = Number(data.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const h = Number(data.heightM);
  const range = Number.isFinite(h) ? Math.min(20_000_000, Math.max(800, h)) : 25_000;
  return { lat, lon, range };
}

/** Command Center layer id → the globe's own layer that shows it. */
export const NATIVE_LAYERS = Object.freeze({
  flights: 'flights',
  'flight-trails': 'flights',
  'military-air': 'military',
  maritime: 'ais-live-vessels',
  'live-cameras': 'cctv',
});

/** Split a host layer list into native globe layers to show and Overcast layer ids to draw. */
export function planLayers(list) {
  const ids = sanitizeLayerIds(list);
  const native = new Set();
  const overcast = [];
  for (const id of ids) {
    if (NATIVE_LAYERS[id]) native.add(NATIVE_LAYERS[id]);
    else overcast.push(id);
  }
  return { native, overcast };
}

const RESTORE_ORIGINS = new Set(['share-restore', 'local-restore']);
const hostPlans = new WeakMap();

/**
 * While the host drives the globe, the globe's own saved-state restore must
 * not switch host-managed layers back. Seen on production 24 Sep 2026: the
 * layer loaded 828 points from ?layers=, then the local restore turned it off.
 * Exported for tests.
 */
export function hostLayerGuard(getPlan) {
  const nativeIds = new Set(Object.values(NATIVE_LAYERS));
  return (change) => {
    const plan = getPlan();
    if (!plan || !RESTORE_ORIGINS.has(change?.origin)) return null;
    if (change.layerId === OVERCAST_LAYERS_ID) {
      const want = plan.overcast.length > 0;
      return change.enabled === want ? null : 'Overcast host controls this layer';
    }
    if (nativeIds.has(change.layerId)) {
      const want = plan.native.has(change.layerId);
      return change.enabled === want ? null : 'Overcast host controls this layer';
    }
    return null;
  };
}

/** Apply a host layer list to the globe's layer manager. */
export async function applyHostLayers(dataManager, list) {
  if (!dataManager?.layers?.get) return null;
  const plan = planLayers(list);
  if (!hostPlans.has(dataManager) && typeof dataManager.addVisibilityGuard === 'function') {
    dataManager.addVisibilityGuard(hostLayerGuard(() => hostPlans.get(dataManager)?.plan ?? null));
  }
  hostPlans.set(dataManager, { plan });
  const nativeIds = [...new Set(Object.values(NATIVE_LAYERS))];
  const work = [];
  for (const id of nativeIds) {
    if (dataManager.layers.has(id)) work.push(dataManager.setEnabled(id, plan.native.has(id), { origin: 'overcast-host' }).catch(() => undefined));
  }
  const entry = dataManager.layers.get(OVERCAST_LAYERS_ID);
  entry?.module?.setOvercastLayers?.(plan.overcast);
  if (entry) work.push(dataManager.setEnabled(OVERCAST_LAYERS_ID, plan.overcast.length > 0, { origin: 'overcast-host' }).catch(() => undefined));
  await Promise.all(work);
  return plan;
}

export function installOvercastBridge({ viewer, signal, dataManager = null, origin = globalThis.location?.origin }) {
  // Standalone /globe/?layers=a,b,c (the Command Center's "Full screen" link).
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('layers');
    if (q && dataManager) void applyHostLayers(dataManager, q.split(','));
  } catch {
    /* no location in tests */
  }
  const onMessage = (event) => {
    if (event.origin !== origin) return;
    if (event.data?.type === 'overcast:layers') {
      if (dataManager) void applyHostLayers(dataManager, event.data.layers);
      return;
    }
    const fly = validFlyTo(event.data);
    if (!fly) return;
    if (activeCameraMotionId()) interruptCameraMotion('overcast:flyTo');
    flyToLandmark(viewer, fly.lat, fly.lon, { range: fly.range, pitch: -50, buildingHeight: 0, duration: 2.5 });
  };
  globalThis.addEventListener('message', onMessage);
  // Tell the Command Center we can take its layer list now (it also resends on change).
  try {
    if (globalThis.parent && globalThis.parent !== globalThis) globalThis.parent.postMessage({ type: 'overcast:ready' }, origin);
  } catch {
    /* cross-origin parent: not ours */
  }
  signal?.addEventListener('abort', () => globalThis.removeEventListener('message', onMessage), { once: true });
}

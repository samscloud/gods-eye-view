/**
 * Overcast host bridge. When the globe runs inside the Command Center's map
 * panel (a same-origin iframe), the host drives it with postMessage:
 *
 *   { type: 'overcast:flyTo', lat, lon, heightM? }
 *
 * The move goes through the globe's own flyToLandmark, so the render governor
 * and camera-motion ownership apply exactly as for an in-globe fly-to. Only
 * messages from our own origin are accepted.
 */
import { flyToLandmark } from './locations.js';
import { interruptCameraMotion, activeCameraMotionId } from './cameraVerbs.js';

export function validFlyTo(data) {
  if (!data || data.type !== 'overcast:flyTo') return null;
  const lat = Number(data.lat);
  const lon = Number(data.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const h = Number(data.heightM);
  const range = Number.isFinite(h) ? Math.min(20_000_000, Math.max(800, h)) : 25_000;
  return { lat, lon, range };
}

export function installOvercastBridge({ viewer, signal, origin = globalThis.location?.origin }) {
  const onMessage = (event) => {
    if (event.origin !== origin) return;
    const fly = validFlyTo(event.data);
    if (!fly) return;
    if (activeCameraMotionId()) interruptCameraMotion('overcast:flyTo');
    flyToLandmark(viewer, fly.lat, fly.lon, { range: fly.range, pitch: -50, buildingHeight: 0, duration: 2.5 });
  };
  globalThis.addEventListener('message', onMessage);
  signal?.addEventListener('abort', () => globalThis.removeEventListener('message', onMessage), { once: true });
}

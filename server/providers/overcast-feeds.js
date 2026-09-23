/**
 * The feed plugins Overcast runs on its own server (approved 23 Sep 2026:
 * "port their feed code"). Aircraft (OpenSky with the adsb.lol regional
 * fallback, military, trails, adsbdb enrichment) and cameras only.
 *
 * Deliberately NOT here: key setup (writes keys to disk), the OpenAI realtime
 * relay (spends a platform key per visitor), and every provider whose layer
 * Overcast has not taken on yet. Overcast's server/globe.ts mounts exactly
 * this list and refuses anything else by name.
 */
import { openSkyProxy } from './aircraft/opensky.js';
import { adsbLolProxy } from './aircraft/adsb-lol.js';
import { trackBackfillProxies } from './aircraft/tracks.js';
import { adsbdbProxy } from './aircraft/enrichment.js';
import { cctvProxy } from './cctv.js';
import { defaultSourceRoot } from './common/source-root.js';

export const OVERCAST_FEED_PLUGIN_NAMES = Object.freeze([
  'opensky-proxy',
  'adsblol-proxy',
  'track-backfill-proxies',
  'adsbdb-proxy',
  'cctv-proxy',
]);

export function overcastFeedPlugins() {
  return [
    openSkyProxy(),
    adsbLolProxy(),
    trackBackfillProxies(),
    adsbdbProxy(),
    cctvProxy({ sourceRoot: defaultSourceRoot }),
  ];
}

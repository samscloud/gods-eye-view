/**
 * Overcast live sources. The Overcast server answers these from its own feeds
 * (the adsb.lol cache behind flights.live, the AISStream socket behind
 * maritime.vessels), so the globe and the Command Center read the same data.
 *
 * Aircraft rows are raw readsb rows, so the existing readsb normalizer applies
 * unchanged. Tracks and enrichment are not served yet; they refuse with a
 * reason rather than pretending (the layers already handle `unsupported`).
 */
import {
  finite,
  httpError,
  LiveSourceError,
  readResponse,
} from './contract.js';
import { readsbIdentities, readsbSnapshot } from './aircraft.js';

const defaultFetch = (...args) => globalThis.fetch(...args);

const AIRCRAFT_URL = '/api/globe/aircraft';

async function readAircraft(fetchImpl, scope, signal) {
  const { response, payload } = await readResponse(
    fetchImpl,
    `${AIRCRAFT_URL}?scope=${scope}`,
    { signal, cache: 'no-store' },
    'Overcast aircraft',
  );
  if (!response.ok) {
    const error = httpError(response, 'Overcast aircraft');
    if (payload?.reason) error.message = `Aircraft feed unavailable: ${payload.reason}`;
    throw error;
  }
  return payload;
}

/** scope 'all' = every aircraft in the feed; 'mil' = military only. */
export function createOvercastAircraftSource({
  scope = 'all',
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  const coverage =
    scope === 'mil'
      ? 'military aircraft, worldwide upstream snapshot'
      : 'worldwide upstream snapshot';
  return {
    label: 'adsb.lol via Overcast',
    async getIdentities(_query = {}, { signal } = {}) {
      return readsbIdentities(await readAircraft(fetchImpl, 'mil', signal));
    },
    async getSnapshot(_query = {}, { signal } = {}) {
      const payload = await readAircraft(fetchImpl, scope, signal);
      const observedAtMs = finite(payload?.now);
      const age = finite(payload?.ageMs);
      return {
        ...readsbSnapshot(payload, {
          observedAtMs,
          source: 'adsb.lol via Overcast',
          coverage,
          now: now(),
          stale: age != null && age > 120000,
        }),
        status: 200,
      };
    },
    async getTrack() {
      throw new LiveSourceError('unsupported', 'Flight history is not available yet');
    },
    async getEnrichment() {
      throw new LiveSourceError('unsupported', 'Enrichment unavailable');
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { openSkyProxy, OPENSKY_STATES_TIMEOUT_MS, OPENSKY_UNREACHABLE_COOLDOWN_MS } from '../../server/providers/aircraft/opensky.js';

// Overcast production, 23 Sep 2026: OpenSky was unreachable from the host and
// every /api/opensky request waited ~10 s before the adsb.lol fallback. After
// one failure the proxy must skip OpenSky and answer from the fallback.
test('an unreachable OpenSky is tried once, then skipped for the cooldown', async () => {
  assert.ok(OPENSKY_STATES_TIMEOUT_MS <= 8000);
  assert.ok(OPENSKY_UNREACHABLE_COOLDOWN_MS >= 60_000);
  const realFetch = globalThis.fetch;
  let openskyCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('opensky-network.org')) { openskyCalls++; throw new TypeError('fetch failed'); }
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify({ ac: [], now: Date.now() }), json: async () => ({ ac: [], now: Date.now() }) };
  };
  let handler;
  openSkyProxy().configureServer({ middlewares: { use: (path, fn) => { if (path === '/api/opensky') handler = fn; } } });
  const call = () => new Promise((resolve) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, writeHead(s, h) { this.statusCode = s; Object.assign(this.headers, h || {}); }, end(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); } };
    handler({ url: '/?lat=51.5&lon=-0.1', originalUrl: '/api/opensky?lat=51.5&lon=-0.1', headers: {} }, res);
  });
  try {
    await call();
    await call();
    assert.equal(openskyCalls, 1, 'second request must not retry OpenSky during the cooldown');
  } finally {
    globalThis.fetch = realFetch;
  }
});

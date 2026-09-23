import test from 'node:test';
import assert from 'node:assert/strict';
import { createOvercastAircraftSource } from './overcast.js';

const reply = (status, body) => async () => ({ ok: status < 400, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });

test('aircraft come from /api/globe/aircraft and parse as readsb rows', async () => {
  let seen = '';
  const src = createOvercastAircraftSource({
    scope: 'mil',
    now: () => 1_000_000,
    fetchImpl: async (url, init) => { seen = url; return reply(200, { now: 999_000, ageMs: 1000, ac: [{ hex: 'AE1234', flight: 'RCH1 ', lat: 1, lon: 2, alt_baro: 30000, gs: 400, track: 90 }] })(url, init); },
  });
  const snap = await src.getSnapshot();
  assert.equal(seen, '/api/globe/aircraft?scope=mil');
  assert.equal(snap.records.length, 1);
  assert.equal(snap.records[0].id, 'ae1234');
  assert.equal(snap.source, 'adsb.lol via Overcast');
  assert.equal(snap.freshness, 'current');
});

test('a feed failure carries the server reason, never an empty snapshot', async () => {
  const src = createOvercastAircraftSource({ fetchImpl: reply(503, { reason: 'adsb.lol unavailable' }) });
  await assert.rejects(src.getSnapshot(), /Aircraft feed unavailable: adsb.lol unavailable/);
});

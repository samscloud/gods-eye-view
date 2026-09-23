import test from 'node:test';
import assert from 'node:assert/strict';
import { validFlyTo } from './overcastBridge.js';
import { isOvercastUnavailable, OVERCAST_UNAVAILABLE_LAYERS } from './overcastAvailability.js';

test('overcast:flyTo accepts only well-formed coordinates and bounds the height', () => {
  assert.deepEqual(validFlyTo({ type: 'overcast:flyTo', lat: 29.76, lon: -95.37 }), { lat: 29.76, lon: -95.37, range: 25000 });
  assert.equal(validFlyTo({ type: 'overcast:flyTo', lat: 29.76, lon: -95.37, heightM: 10 }).range, 800);
  assert.equal(validFlyTo({ type: 'overcast:flyTo', lat: 91, lon: 0 }), null);
  assert.equal(validFlyTo({ type: 'other', lat: 1, lon: 1 }), null);
  assert.equal(validFlyTo(null), null);
});

test('layers Overcast does not serve are listed and the served ones are not', () => {
  for (const id of ['radio', 'satellites', 'military-installations', 'alpr-cameras']) assert.equal(isOvercastUnavailable(id), true, id);
  for (const id of ['flights', 'military', 'ais-live-vessels', 'cctv', 'earthquakes']) assert.equal(isOvercastUnavailable(id), false, id);
  assert.ok(Object.isFrozen(OVERCAST_UNAVAILABLE_LAYERS));
});

test('the gate refuses to enable unavailable layers and hides them, leaving others alone', async () => {
  const { gateUnavailableLayers } = await import('./overcastAvailability.js');
  const calls = [];
  const manager = {
    _setEnabledWithIntent(id, on) { calls.push([id, on]); return { intentEpoch: 1, promise: Promise.resolve(true) }; },
    getAll() { return [{ id: 'radio', showInTogglePanel: true }, { id: 'flights', showInTogglePanel: true }]; },
  };
  gateUnavailableLayers(manager);
  assert.equal(await manager._setEnabledWithIntent('radio', true).promise, false);
  assert.equal(await manager._setEnabledWithIntent('radio', false).promise, true);
  assert.equal(await manager._setEnabledWithIntent('flights', true).promise, true);
  assert.deepEqual(calls, [['radio', false], ['flights', true]]);
  assert.deepEqual(manager.getAll().map((r) => [r.id, r.showInTogglePanel]), [['radio', false], ['flights', true]]);
});

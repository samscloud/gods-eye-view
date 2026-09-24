import test from 'node:test';
import assert from 'node:assert/strict';
import { rowToPoint, sanitizeLayerIds, layerAccent } from '../overcastLayers.js';
import { planLayers } from '../overcastBridge.js';

test('sanitizeLayerIds keeps well-formed ids, dedupes, drops junk', () => {
  assert.deepEqual(sanitizeLayerIds(['fema-disasters', 'fema-disasters', 'Bad Id', '../x', 'gdacs-alerts']), ['fema-disasters', 'gdacs-alerts']);
  assert.deepEqual(sanitizeLayerIds('fema'), []);
});

test('rowToPoint draws located rows only, never (0,0)', () => {
  const row = { event_id: 'e1', start_ts: '2026-09-23T12:00:00.000Z', geo: { lat: 29.9, lon: -90.1 }, severity: { label: 'high' }, source: { provider_name: 'FEMA', item_url: 'https://fema.gov/x' }, attributes: { title: 'Hurricane Delta' } };
  assert.deepEqual(rowToPoint('fema-disasters', row), { id: 'fema-disasters:e1', layerId: 'fema-disasters', lat: 29.9, lon: -90.1, label: 'Hurricane Delta', severity: 'high', source: 'FEMA', url: 'https://fema.gov/x', time: '2026-09-23T12:00:00.000Z', reference: false });
  assert.equal(rowToPoint('x', { ...row, geo: { lat: 0, lon: 0 } }), null);
  assert.equal(rowToPoint('x', { ...row, geo: null }), null);
  assert.equal(rowToPoint('x', { ...row, source: { item_url: 'javascript:alert(1)' } }).url, '');
});

test('layerAccent is stable per id', () => {
  assert.equal(layerAccent('bases'), layerAccent('bases'));
});

test('planLayers sends flights, military, vessels and cameras to the globe’s own layers', () => {
  const plan = planLayers(['flights', 'military-air', 'maritime', 'live-cameras', 'fema-disasters', 'weather']);
  assert.deepEqual([...plan.native].sort(), ['ais-live-vessels', 'cctv', 'flights', 'military']);
  assert.deepEqual(plan.overcast, ['fema-disasters', 'weather']);
});

test('hostLayerGuard keeps host-managed layers as the host set them during restore', async () => {
  const { hostLayerGuard } = await import('../overcastBridge.js');
  const plan = planLayers(['fema-disasters', 'flights']);
  const guard = hostLayerGuard(() => plan);
  assert.equal(guard({ layerId: 'overcast-layers', enabled: false, origin: 'local-restore' }), 'Overcast host controls this layer');
  assert.equal(guard({ layerId: 'overcast-layers', enabled: true, origin: 'local-restore' }), null);
  assert.equal(guard({ layerId: 'flights', enabled: false, origin: 'share-restore' }), 'Overcast host controls this layer');
  assert.equal(guard({ layerId: 'overcast-layers', enabled: false, origin: 'user' }), null);
  assert.equal(guard({ layerId: 'traffic', enabled: true, origin: 'local-restore' }), null);
  assert.equal(hostLayerGuard(() => null)({ layerId: 'overcast-layers', enabled: false, origin: 'local-restore' }), null);
});

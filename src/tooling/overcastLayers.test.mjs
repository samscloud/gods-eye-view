import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMaxDistance, rowToPoint, sanitizeLayerIds, layerAccent, formatAge, overcastCardModel, dedupePoints } from '../overcastLayers.js';
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

test('Overcast items get the same card shape as FIRMS and vessel cards', () => {
  const now = Date.parse('2026-09-24T03:00:00Z');
  const p = rowToPoint('conflicts', {
    event_id: 'x1', geo: { lat: 48.5, lon: 37.9 }, start_ts: '2026-09-24T01:00:00Z',
    severity: { label: 'critical' }, source: { provider_name: 'ACLED' }, attributes: { title: 'Shelling near Bakhmut reported by local authorities' },
  });
  const m = overcastCardModel(p, { name: 'Conflicts', accent: '248, 113, 113' }, now);
  assert.equal(m.ambient.title, 'Shelling near Bakhmut repor…');
  assert.deepEqual(m.ambient.details, ['CONFLICTS · CRITICAL · 2h']);
  assert.deepEqual(m.selected.details, ['CONFLICTS · CRITICAL', 'ACLED · 2026-09-24 01:00 UTC', '48.500, 37.900']);
  assert.equal(m.accent, '248, 113, 113');
});

test('reference rows say so instead of an age, and unknown times say not reported', () => {
  const ref = rowToPoint('bases', { event_id: 'b', geo: { lat: 11.5, lon: 43.1 }, attributes: { name: 'Camp Lemonnier', reference: true } });
  assert.match(overcastCardModel(ref, { name: 'Bases' }).ambient.details[0], /REFERENCE/);
  assert.match(overcastCardModel(ref, { name: 'Bases' }).selected.details[1], /reference table/);
  assert.equal(formatAge('not a date'), '');
  assert.equal(formatAge('2026-09-24T02:30:00Z', Date.parse('2026-09-24T03:00:00Z')), '30m');
});

test('a repeated event id draws once instead of failing the layer', () => {
  const rows = [
    { event_id: 'fema-5676', geo: { lat: 30, lon: -90 }, attributes: { title: 'A' } },
    { event_id: 'fema-5676', geo: { lat: 31, lon: -91 }, attributes: { title: 'B' } },
    { event_id: 'fema-5677', geo: { lat: 32, lon: -92 }, attributes: { title: 'C' } },
  ];
  const pts = dedupePoints(rows.map((r) => rowToPoint('fema-disasters', r)).filter(Boolean));
  assert.deepEqual(pts.map((p) => p.label), ['A', 'C']);
});

test('critical and high cards stay visible from the whole-globe view; others appear on zoom', () => {
  assert.ok(cardMaxDistance('critical') >= 20_000_000);
  assert.ok(cardMaxDistance('high') >= 20_000_000);
  assert.equal(cardMaxDistance('medium'), 2_500_000);
  assert.equal(cardMaxDistance(undefined), 2_500_000);
});

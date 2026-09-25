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
  const pt = rowToPoint('fema-disasters', row);
  assert.deepEqual({ ...pt, attrs: undefined, kind: undefined, ends: undefined }, { id: 'fema-disasters:e1', layerId: 'fema-disasters', lat: 29.9, lon: -90.1, label: 'Hurricane Delta', severity: 'high', source: 'FEMA', url: 'https://fema.gov/x', time: '2026-09-23T12:00:00.000Z', reference: false, attrs: undefined, kind: undefined, ends: undefined });
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
  assert.equal(m.ambient.title, 'Shelling near Bakhmut reported by…');
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

test('cards say what the item is: NWS area and expiry, volcano alert level, quake depth', async () => {
  const now = Date.parse('2026-09-25T00:00:00Z');
  const nws = rowToPoint('weather-alerts', {
    event_id: 'n1', event_type: 'weather-alert', geo: { lat: 64.5, lon: -165.4 }, start_ts: '2026-09-24T20:00:00Z', end_ts: '2026-09-25T18:00:00Z',
    severity: { label: 'high' }, source: { provider_name: 'NWS' },
    attributes: { event: 'Coastal Flood Warning', headline: 'Coastal Flood Warning issued September 24 at 12:00PM AKDT until September 25 at 10:00AM AKDT by NWS Fairbanks AK', areaDesc: 'Norton Sound Coast; Bering Strait Coast', located: true },
  });
  const m = overcastCardModel(nws, { name: 'Weather Alerts' }, now);
  assert.equal(m.ambient.title, 'Coastal Flood Warning');
  assert.deepEqual(m.ambient.details, ['Norton Sound Coast · until 18:00 UTC', 'WEATHER ALERTS · HIGH · 4h']);
  assert.ok(m.selected.details.some((l) => l.startsWith('Coastal Flood Warning issued')), 'headline in the selected card');

  const volc = rowToPoint('volcanoes', {
    event_id: 'v1', event_type: 'volcanic-activity', geo: { lat: 59.36, lon: -153.43 }, start_ts: '2026-09-24T23:57:00Z',
    severity: { label: 'high' }, source: { provider_name: 'USGS' },
    attributes: { name: 'Augustine', volcano_name: 'Augustine', region: 'Alaska', elevation_m: 1252, alert_level: 'ADVISORY', color_code: 'YELLOW', synopsis: 'Elevated seismicity continues.' },
  });
  const v = overcastCardModel(volc, { name: 'Volcanoes' }, now);
  assert.equal(v.ambient.title, 'Augustine');
  assert.deepEqual(v.ambient.details, ['Alert ADVISORY · Aviation YELLOW', 'VOLCANOES · HIGH · 3m']);
  assert.ok(v.selected.details.includes('Alaska · 1,252 m'));
  assert.ok(v.selected.details.includes('Elevated seismicity continues.'));

  const q = rowToPoint('earthquakes', { event_id: 'q', event_type: 'earthquake', geo: { lat: 1, lon: 2 }, start_ts: '2026-09-24T23:00:00Z', attributes: { title: 'M 5.1 - 80 km S of Adak, Alaska', depth: 33.2 } });
  assert.deepEqual(overcastCardModel(q, { name: 'Earthquakes' }, now).ambient.details[0], 'Depth 33.2 km');
});

test('facts never invent a value the feed did not send', async () => {
  const { describeOvercastPoint, sanitizeAttributes } = await import('../overcastFacts.js');
  const d = describeOvercastPoint({ kind: 'tropical-storm', label: 'Storm', attrs: sanitizeAttributes({ name: 'POLO', wind_speed: null, pressure: '', category: 'TS' }) });
  assert.deepEqual(d, { title: 'POLO', facts: ['TS'], summary: '' });
  assert.deepEqual(sanitizeAttributes({ o: { x: 1 }, f: () => 1, n: NaN, s: '  ok ' }), { s: 'ok' });
});

test('clusters are a small themed count badge, not a bare white number', async () => {
  const { clusterBadgeDataUrl } = await import('../overcastLayers.js');
  const svg = decodeURIComponent(clusterBadgeDataUrl(18, { header: '#120f0a', accent: '#f59e0b', text: '#fef3c7' }).split(',')[1]);
  assert.match(svg, />18</);
  assert.match(svg, /fill="#120f0a"/);
  assert.match(svg, /stroke="#f59e0b"/);
  assert.match(svg, /fill="#fef3c7">18</);
  assert.match(decodeURIComponent(clusterBadgeDataUrl(250).split(',')[1]), />99\+</);
  assert.match(decodeURIComponent(clusterBadgeDataUrl(3, { accent: 'url(x)' }).split(',')[1]), /stroke="#60a5fa"/, 'bad tokens fall back');
  const src = (await import('node:fs')).readFileSync(new URL('../overcastLayers.js', import.meta.url), 'utf8');
  assert.match(src, /cluster\.label\.show = false/);
});

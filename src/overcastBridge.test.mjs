import test from 'node:test';
import assert from 'node:assert/strict';
import { fullScreenHref, installFullScreenLink, validFlyTo } from './overcastBridge.js';
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

test('full screen opens the standalone globe with the host\'s layers and theme', () => {
  assert.equal(fullScreenHref(), '/globe/');
  assert.equal(fullScreenHref({ layers: ['wildfires', 'flights', 'flights', 'BAD ID'], theme: 'tactical' }), '/globe/?layers=flights%2Cwildfires&theme=tactical');
  assert.equal(fullScreenHref({ layers: [], theme: 'x"><script>' }), '/globe/', 'a malformed theme id is dropped');
});

test('the full-screen link closes the embed\'s tools stack, and only in the embed', () => {
  const make = (tag) => {
    const attrs = new Map();
    const classes = new Set();
    const node = {
      tagName: tag.toUpperCase(), children: [], textContent: '', className: '',
      classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c) },
      setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null,
      append: (...kids) => node.children.push(...kids),
    };
    return node;
  };
  const docFor = (embed) => {
    const html = make('html');
    if (embed) html.classList.add('overcast-embed');
    const stack = make('nav');
    return { stack, doc: { documentElement: html, createElement: make, getElementById: (id) => (id === 'top-center-actions' ? stack : null) } };
  };
  assert.equal(installFullScreenLink(docFor(false)), null);
  const { doc, stack } = docFor(true);
  const link = installFullScreenLink({ doc });
  assert.equal(stack.children.at(-1), link);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener');
  assert.equal(link.getAttribute('aria-label'), 'Open the globe full screen');
  assert.equal(link.children[0].textContent, 'open_in_full');
});

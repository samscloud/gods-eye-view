import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BAR_COLLAPSED_KEY, FLIGHT_ACTIONS, installOvercastCommandBar } from '../overcastCommandBar.js';

function evt() {
  const fns = new Set();
  return { addEventListener: (fn) => (fns.add(fn), () => fns.delete(fn)), raise: (...a) => [...fns].forEach((f) => f(...a)), size: () => fns.size };
}

function fakeDom({ embed = true } = {}) {
  const byId = new Map();
  const docListeners = new Map();
  const make = (tag) => {
    const classes = new Set();
    const attrs = new Map();
    const own = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      value: '',
      textContent: '',
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c), classes.has(c)),
      },
      set className(v) { v.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      append: (...kids) => kids.forEach((k) => { node.children.push(k); if (k.id) byId.set(k.id, k); }),
      addEventListener: (type, fn) => own.set(type, fn),
      fire: (type, e = {}) => own.get(type)?.({ preventDefault() {}, ...e }),
      focus() { node.focused = true; },
      click() { node.clicked = (node.clicked || 0) + 1; },
      set id(v) { this._id = v; if (v) byId.set(v, this); },
      get id() { return this._id; },
    };
    return node;
  };
  const html = make('html');
  if (embed) html.classList.add('overcast-embed');
  const body = make('body');
  const doc = {
    documentElement: html,
    body,
    createElement: make,
    getElementById: (id) => byId.get(id) || null,
    dispatchEvent: (e) => docListeners.get(e.type)?.(e),
    addEventListener: (t, fn) => docListeners.set(t, fn),
  };
  const entry = make('button'); entry.id = 'cockpit-entry';
  const exit = make('button'); exit.id = 'map-view-switch';
  const find = (cls) => {
    const walk = (n) => (n.classList?.contains(cls) ? n : n.children.map(walk).find(Boolean));
    return walk(body);
  };
  return { doc, html, body, entry, exit, find };
}

function fakeViewer() {
  const tick = evt();
  return {
    trackedEntity: undefined,
    trackedEntityChanged: evt(),
    clock: { onTick: tick },
    tick,
    camera: { position: { x: 0, y: -3000, z: 1000 }, rotateRight(a) { this.rotated = (this.rotated || 0) + a; }, zoomIn(d) { this.zoomedIn = d; }, zoomOut(d) { this.zoomedOut = d; } },
    scene: { requestRender() {} },
  };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('outside the embed nothing is added', () => {
  const { doc } = fakeDom({ embed: false });
  assert.equal(installOvercastCommandBar({ doc, win: {} }), null);
});

test('the mic and a type box are on screen by default; hiding folds to one mic and is remembered', () => {
  const { doc, html } = fakeDom();
  const storage = memoryStorage();
  installOvercastCommandBar({ doc, win: {}, storage, voice: () => null });
  assert.ok(doc.getElementById('oc-command-bar'), 'bar present');
  assert.equal(html.classList.contains('oc-command-collapsed'), false, 'visible by default');
  const bar = doc.getElementById('oc-command-bar');
  bar.children.find((c) => c.classList.contains('oc-cmd-hide')).fire('click');
  assert.equal(html.classList.contains('oc-command-collapsed'), true);
  assert.equal(storage.getItem(BAR_COLLAPSED_KEY), '1');
  doc.getElementById('oc-command-show').fire('click');
  assert.equal(html.classList.contains('oc-command-collapsed'), false);
});

test('the mic toggles the AI agent; typing sends the same agent a command and shows its reply', async () => {
  const { doc, find } = fakeDom();
  let listener = null;
  const calls = [];
  let active = false;
  const session = {
    subscribe: (fn) => ((listener = fn), () => {}),
    isActive: () => active,
    start: () => { calls.push('start'); active = true; },
    stop: () => { calls.push('stop'); active = false; },
    sendText: (t) => calls.push(`text:${t}`),
  };
  const ac = new AbortController();
  installOvercastCommandBar({ doc, win: {}, storage: memoryStorage(), voice: () => session, signal: ac.signal });
  const mic = find('oc-cmd-mic');
  mic.fire('click');
  mic.fire('click');
  assert.deepEqual(calls, ['start', 'stop']);
  const input = find('oc-cmd-input');
  input.value = '  fly to Houston ';
  find('oc-cmd-form').fire('submit');
  assert.equal(calls.at(-1), 'text:fly to Houston');
  assert.equal(input.value, '');
  listener({ type: 'transcript', role: 'assistant', text: 'Flying to Houston.' });
  assert.equal(doc.getElementById('oc-command-reply').textContent, 'Flying to Houston.');
  listener({ type: 'state', state: 'listening' });
  assert.equal(doc.getElementById('oc-command-bar').dataset.status, 'listening');
  ac.abort();
});

test('flight controls appear only while an aircraft is followed, and drive the tracked camera', () => {
  const { doc, html, entry, find } = fakeDom();
  const viewer = fakeViewer();
  installOvercastCommandBar({ doc, win: { addEventListener() {} }, viewer, storage: memoryStorage(), voice: () => null });
  assert.equal(html.classList.contains('oc-flight-active'), false, 'hidden with nothing tracked');
  viewer.trackedEntity = { id: 'af24fb' };
  viewer.trackedEntityChanged.raise();
  assert.equal(html.classList.contains('oc-flight-active'), true);
  find('oc-flight-orbit').fire('click');
  viewer.tick.raise();
  assert.ok(viewer.camera.rotated > 0, 'orbit turns the camera');
  find('oc-flight-zoom-in').fire('click');
  assert.ok(viewer.camera.zoomedIn > 0);
  find('oc-flight-cockpit').fire('click');
  assert.equal(entry.clicked, 1, 'cockpit uses the globe\'s own cockpit entry');
  viewer.trackedEntity = undefined;
  viewer.trackedEntityChanged.raise();
  assert.equal(html.classList.contains('oc-flight-active'), false);
});

test('every glyph is in the icon subset, and the bar is embed-only in CSS', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const names = new Set(/icon_names=([^"&]*)/.exec(html)[1].split(','));
  for (const g of ['send', 'expand_more', ...FLIGHT_ACTIONS.map((a) => a.icon)]) assert.ok(names.has(g), g);
  const css = readFileSync(new URL('../ui/styles/overcast-embed.css', import.meta.url), 'utf8');
  assert.match(css, /html:not\(\.overcast-embed\) #oc-command-bar,/);
  assert.match(css, /font: 400 16px\/1/, 'the input is 16px so iOS does not zoom');
});

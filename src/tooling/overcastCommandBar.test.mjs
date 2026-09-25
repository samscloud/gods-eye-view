import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BAR_COLLAPSED_KEY, FLIGHT_ACTIONS, ICONS, SUGGESTIONS, installOvercastCommandBar } from '../overcastCommandBar.js';

function evt() {
  const fns = new Set();
  return { addEventListener: (fn) => (fns.add(fn), () => fns.delete(fn)), raise: (...a) => [...fns].forEach((f) => f(...a)) };
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
      innerHTML: '',
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c), classes.has(c)),
      },
      set className(v) { v.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      append: (...kids) => kids.forEach((k) => { if (typeof k === 'object') { node.children.push(k); if (k.id) byId.set(k.id, k); } }),
      addEventListener: (type, fn) => own.set(type, fn),
      fire: (type, e = {}) => own.get(type)?.({ preventDefault() {}, ...e }),
      focus() { node.focused = true; },
      blur() { node.focused = false; },
      click() { node.clicked = (node.clicked || 0) + 1; },
      set id(v) { this._id = v; if (v) byId.set(v, this); },
      get id() { return this._id; },
    };
    return node;
  };
  const html = make('html');
  html.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
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

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

function fakeSession() {
  let listener = null;
  let active = false;
  const calls = [];
  return {
    calls,
    emit: (e) => listener?.(e),
    subscribe: (fn) => ((listener = fn), () => {}),
    isActive: () => active,
    start: () => { calls.push('start'); active = true; },
    stop: () => { calls.push('stop'); active = false; },
    sendText: (t) => calls.push(`text:${t}`),
  };
}

test('outside the embed nothing is added', () => {
  const { doc } = fakeDom({ embed: false });
  assert.equal(installOvercastCommandBar({ doc, win: {} }), null);
});

test('the Ask bar is on screen by default; hide (or swipe down) folds it to one orb, remembered', () => {
  const { doc, html, find } = fakeDom();
  const storage = memoryStorage();
  installOvercastCommandBar({ doc, win: {}, storage, voice: () => null });
  assert.ok(doc.getElementById('oc-ask'));
  assert.equal(html.classList.contains('oc-command-collapsed'), false);
  find('oc-ask-hide').fire('click');
  assert.equal(html.classList.contains('oc-command-collapsed'), true);
  assert.equal(storage.getItem(BAR_COLLAPSED_KEY), '1');
  assert.equal(html.style.props['--oc-ask-h'], '0px', 'hidden: the map credit drops to the corner');
  doc.getElementById('oc-ask-orb').fire('click');
  assert.equal(html.classList.contains('oc-command-collapsed'), false);
  const bar = find('oc-ask-bar');
  bar.fire('touchstart', { touches: [{ clientY: 300 }] });
  bar.fire('touchend', { changedTouches: [{ clientY: 350 }] });
  assert.equal(html.classList.contains('oc-command-collapsed'), true, 'swipe down hides');
});

test('one action button: talk when empty, send when typed, stop while listening', () => {
  const { doc, find } = fakeDom();
  const s = fakeSession();
  const ac = new AbortController();
  installOvercastCommandBar({ doc, win: {}, storage: memoryStorage(), voice: () => s, signal: ac.signal });
  const ask = doc.getElementById('oc-ask');
  const action = find('oc-ask-action');
  const input = find('oc-ask-input');
  assert.equal(ask.dataset.state, 'idle');
  action.fire('click');
  assert.deepEqual(s.calls, ['start']);
  s.emit({ type: 'state', state: 'listening' });
  assert.equal(ask.dataset.state, 'listening');
  assert.equal(action.getAttribute('aria-label'), 'Stop listening');
  action.fire('click');
  assert.equal(s.calls.at(-1), 'stop');
  s.emit({ type: 'state', state: 'idle' });
  input.value = 'fly to Houston';
  input.fire('input');
  assert.equal(ask.dataset.state, 'typing');
  assert.equal(action.getAttribute('aria-label'), 'Send');
  action.fire('click');
  assert.equal(s.calls.at(-1), 'text:fly to Houston');
  assert.equal(input.value, '');
  assert.equal(ask.dataset.state, 'thinking');
  assert.equal(find('oc-ask-live').textContent, '“fly to Houston”', 'while thinking, the bar shows what it heard');
  s.emit({ type: 'transcript', role: 'assistant', text: 'Flying to Houston.' });
  assert.equal(find('oc-answer-text').textContent, 'Flying to Houston.');
  assert.equal(find('oc-answer-asked').textContent, 'fly to Houston', 'the answer sits under the question');
  s.emit({ type: 'transcript', role: 'user', text: 'show me Taiwan' });
  s.emit({ type: 'state', state: 'thinking' });
  assert.equal(find('oc-ask-live').textContent, '“show me Taiwan”', 'spoken questions too');
  assert.equal(ask.classList.contains('has-answer'), true);
  find('oc-answer-close').fire('click');
  assert.equal(ask.classList.contains('has-answer'), false);
  ac.abort();
});

test('focusing an empty field offers suggestions; a suggestion goes to the agent', () => {
  const { doc, find } = fakeDom();
  const s = fakeSession();
  installOvercastCommandBar({ doc, win: {}, storage: memoryStorage(), voice: () => s });
  find('oc-ask-input').fire('focus');
  assert.equal(doc.getElementById('oc-ask').dataset.state, 'focus');
  const chips = find('oc-ask-suggest').children;
  assert.deepEqual(chips.map((c) => c.textContent), [...SUGGESTIONS]);
  chips[0].fire('click');
  assert.equal(s.calls.at(-1), `text:${SUGGESTIONS[0]}`);
});

test('flight rail order: the exit at the top, the cockpit nearest the thumb', () => {
  assert.deepEqual(FLIGHT_ACTIONS.map((a) => a.id), ['stop', 'recentre', 'orbit', 'cockpit']);
  const css = readFileSync(new URL('../ui/styles/overcast-embed.css', import.meta.url), 'utf8');
  const rail = /\n#oc-flight-rail \{([^}]*)\}/.exec(css)[1];
  assert.match(rail, /bottom: calc\(var\(--oc-edge\) \+ env\(safe-area-inset-bottom, 0px\) \+ 52px \+ 10px\)/, 'just above the bar');
  assert.doesNotMatch(rail, /\btop:/);
  assert.match(css, /html\.oc-flight-active \.oc-answer,\s*html\.oc-flight-active \.oc-ask-suggest \{\s*margin-right: calc\(60px \+ 8px\);/);
});

test('flight rail appears only while following, labelled, and drives the tracked camera', () => {
  const { doc, html, entry, find } = fakeDom();
  const tick = evt();
  const viewer = {
    trackedEntity: undefined,
    trackedEntityChanged: evt(),
    clock: { onTick: tick },
    camera: { rotateRight(a) { this.rotated = (this.rotated || 0) + a; } },
    scene: { requestRender() {} },
  };
  installOvercastCommandBar({ doc, win: { addEventListener() {} }, viewer, storage: memoryStorage(), voice: () => null });
  assert.equal(html.classList.contains('oc-flight-active'), false);
  viewer.trackedEntity = { id: 'af24fb' };
  viewer.trackedEntityChanged.raise();
  assert.equal(html.classList.contains('oc-flight-active'), true);
  const labels = find('oc-flight-rail')?.children ?? doc.getElementById('oc-flight-rail').children;
  assert.deepEqual(labels.map((b) => b.children.find((c) => c.classList.contains('oc-rail-label')).textContent), FLIGHT_ACTIONS.map((a) => a.label));
  find('oc-flight-orbit').fire('click');
  tick.raise();
  assert.ok(viewer.camera.rotated > 0);
  find('oc-flight-cockpit').fire('click');
  assert.equal(entry.clicked, 1);
  viewer.trackedEntity = undefined;
  viewer.trackedEntityChanged.raise();
  assert.equal(html.classList.contains('oc-flight-active'), false);
});

test('icons are inline SVG for every control; the bar is embed-only and 16px for iOS', () => {
  for (const a of FLIGHT_ACTIONS) assert.ok(ICONS[a.icon], a.icon);
  for (const n of ['mic', 'send', 'stop', 'hide', 'close']) assert.ok(ICONS[n], n);
  const css = readFileSync(new URL('../ui/styles/overcast-embed.css', import.meta.url), 'utf8');
  assert.match(css, /html:not\(\.overcast-embed\) #oc-ask,/);
  assert.match(css, /font: 400 16px\/1 var\(--oc-ui\)/);
  assert.match(css, /html\.overcast-embed #share-btn \{\s*display: none !important;/);
});

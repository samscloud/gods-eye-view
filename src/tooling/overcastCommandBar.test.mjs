import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BAR_COLLAPSED_KEY, FLIGHT_ACTIONS, ICONS, STATUS, SUGGESTIONS, installOvercastCommandBar } from '../overcastCommandBar.js';

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

test('the AI agent pod is on the map by default; hide (or swipe down) leaves only the mic, remembered', () => {
  const { doc, html, find } = fakeDom();
  const storage = memoryStorage();
  installOvercastCommandBar({ doc, win: {}, storage, voice: () => null });
  assert.ok(doc.getElementById('oc-ask'));
  assert.equal(find('oc-pod-kicker').textContent, 'AI agent');
  assert.equal(find('oc-pod-status').textContent, STATUS.idle);
  assert.equal(find('oc-pod-meter').children.length, 15, "the globe's 15-bar meter");
  assert.equal(html.classList.contains('oc-command-collapsed'), false);
  find('oc-ask-hide').fire('click');
  assert.equal(html.classList.contains('oc-command-collapsed'), true);
  assert.equal(storage.getItem(BAR_COLLAPSED_KEY), '1');
  assert.equal(html.style.props['--oc-ask-h'], '0px', 'hidden: the map credit drops to the corner');
  doc.getElementById('oc-ask-orb').fire('click');
  assert.equal(html.classList.contains('oc-command-collapsed'), false);
  const pod = find('oc-pod');
  pod.fire('touchstart', { touches: [{ clientY: 300 }] });
  pod.fire('touchend', { changedTouches: [{ clientY: 350 }] });
  assert.equal(html.classList.contains('oc-command-collapsed'), true, 'swipe down hides');
});

test('the mic: tap to talk, tap again to stop; the readout says what it is doing', () => {
  const { doc, find } = fakeDom();
  const s = fakeSession();
  installOvercastCommandBar({ doc, win: {}, storage: memoryStorage(), voice: () => s });
  const ask = doc.getElementById('oc-ask');
  const talk = find('oc-talk');
  talk.fire('click');
  assert.deepEqual(s.calls, ['start']);
  s.emit({ type: 'state', state: 'listening' });
  assert.equal(ask.dataset.state, 'listening');
  assert.equal(find('oc-pod-status').textContent, STATUS.listening);
  assert.equal(talk.getAttribute('aria-label'), 'Stop the AI agent');
  assert.equal(talk.getAttribute('aria-pressed'), 'true');
  s.emit({ type: 'transcript', role: 'user', text: 'show me Taiwan' });
  s.emit({ type: 'state', state: 'thinking' });
  assert.equal(find('oc-pod-status').textContent, STATUS.thinking);
  assert.equal(find('oc-pod-heard').textContent, '› show me Taiwan', 'thinking, it shows what it heard');
  talk.fire('click');
  assert.equal(s.calls.at(-1), 'stop');
  s.emit({ type: 'transcript', role: 'assistant', text: "Here's Taiwan." });
  assert.equal(find('oc-answer-text').textContent, "Here's Taiwan.");
  assert.equal(find('oc-answer-asked').textContent, 'show me Taiwan', 'the answer sits under the question');
  assert.equal(ask.classList.contains('has-answer'), true);
  find('oc-answer-close').fire('click');
  assert.equal(ask.classList.contains('has-answer'), false);
});

test('the keyboard opens a type line in the pod; suggestions while empty; send, or Escape to go back', () => {
  const { doc, find } = fakeDom();
  const s = fakeSession();
  const ac = new AbortController();
  installOvercastCommandBar({ doc, win: {}, storage: memoryStorage(), voice: () => s, signal: ac.signal });
  const ask = doc.getElementById('oc-ask');
  const type = find('oc-type');
  const input = find('oc-ask-input');
  type.fire('click');
  assert.equal(ask.dataset.compose, '1');
  assert.equal(ask.dataset.typed, '0', 'empty: suggestions show (CSS)');
  assert.equal(input.focused, true);
  assert.equal(type.getAttribute('aria-label'), 'Close typing');
  assert.deepEqual(find('oc-ask-suggest').children.map((c) => c.textContent), [...SUGGESTIONS]);
  input.value = 'fly to Houston';
  input.fire('input');
  assert.equal(ask.dataset.typed, '1');
  find('oc-compose').fire('submit');
  assert.equal(s.calls.at(-1), 'text:fly to Houston');
  assert.equal(input.value, '');
  assert.equal(ask.dataset.compose, '0', 'sent: back to the readout');
  assert.equal(ask.dataset.state, 'thinking');
  assert.equal(find('oc-pod-heard').textContent, '› fly to Houston');
  type.fire('click');
  input.value = 'half typed';
  input.fire('keydown', { key: 'Escape' });
  assert.equal(ask.dataset.compose, '0');
  assert.equal(input.value, '', 'Escape clears and closes');
  type.fire('click');
  find('oc-ask-suggest').children[0].fire('click');
  assert.equal(s.calls.at(-1), `text:${SUGGESTIONS[0]}`);
  ac.abort();
});

test('without speech recognition the pod says so and opens the type line', () => {
  const { doc, find } = fakeDom();
  const s = fakeSession();
  installOvercastCommandBar({ doc, win: {}, storage: memoryStorage(), voice: () => s });
  find('oc-talk').fire('click');
  s.emit({ type: 'state', state: 'listening', detail: 'Voice input not supported in this browser — type instead' });
  assert.equal(doc.getElementById('oc-ask').dataset.compose, '1');
  assert.match(find('oc-answer-text').textContent, /type instead/);
});

test('flight rail order: the exit at the top, the cockpit nearest the thumb; low on the right', () => {
  assert.deepEqual(FLIGHT_ACTIONS.map((a) => a.id), ['stop', 'recentre', 'orbit', 'cockpit']);
  const css = readFileSync(new URL('../ui/styles/overcast-embed.css', import.meta.url), 'utf8');
  const rail = /\n#oc-flight-rail \{([^}]*)\}/.exec(css)[1];
  assert.match(rail, /bottom: calc\(var\(--oc-edge\) \+ env\(safe-area-inset-bottom, 0px\) \+ 70px\)/, 'just above the hidden-pod mic');
  assert.doesNotMatch(rail, /\btop:/);
  assert.match(css, /html\.oc-flight-active #oc-ask \{\s*right: calc\(var\(--oc-edge\) \+ 44px \+ 10px\);/, 'on phones the pod keeps left of the rail');
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
  const labels = doc.getElementById('oc-flight-rail').children;
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

test("the globe's own top buttons are left as they were; the pod is embed-only and 16px for iOS", () => {
  for (const a of FLIGHT_ACTIONS) assert.ok(ICONS[a.icon], a.icon);
  for (const n of ['mic', 'keyboard', 'send', 'stop', 'hide', 'close']) assert.ok(ICONS[n], n);
  const css = readFileSync(new URL('../ui/styles/overcast-embed.css', import.meta.url), 'utf8');
  assert.match(css, /html:not\(\.overcast-embed\) #oc-ask,/);
  assert.match(css, /font: 400 16px\/1 var\(--font-mono\)/);
  // Gary B, 25 Sep 2026: "leave that where it was". No restyle of the row,
  // share stays, and following a plane does not remove the camera buttons.
  assert.doesNotMatch(css, /#top-center-actions/);
  assert.doesNotMatch(css, /#share-btn/);
  assert.doesNotMatch(css, /#(tilt-map-view|north-up-view|reset-globe-view)/);
  assert.doesNotMatch(css, /#title-bar \{\s*display: none/);
  assert.match(css, /#oc-controls-sheet #command-dock > #gev-voice-control \{\s*display: none !important;/, 'one AI agent control: the drawer does not repeat the pod');
});

/**
 * The embedded globe's on-screen controls (Command Center, /globe/?embed=1).
 *
 * Gary B, 25 Sep 2026: "we want that mic ... where they could talk to the
 * screen on the home screen as a default ... they can hide it", with a box
 * beside it to type instead; and when you are on a flight, the flight
 * controls (cockpit, orbit ...) as icons down the right side, in thumb reach,
 * so they don't take up the screen.
 *
 *  - Command bar, bottom centre: mic (the same AI agent as the drawer's
 *    voice control, window.__gevVoiceCommands), a text box that sends the
 *    same agent a typed command, send, and hide. Hidden, it folds to a
 *    single mic button; the choice is remembered per browser.
 *  - Flight rail, right edge: shown only while an aircraft is followed or
 *    you are in its cockpit. Cockpit, orbit, zoom in/out, recentre, stop.
 *
 * Everything drives existing globe behaviour (the voice session, the cockpit
 * entry/exit buttons, Escape to stop tracking, the tracked Cesium camera);
 * nothing here re-implements it. The full-screen globe is unchanged.
 */

export const BAR_COLLAPSED_KEY = 'oc-command-bar-collapsed';

/** Material Symbols glyph per flight action. Exported for tests. */
export const FLIGHT_ACTIONS = Object.freeze([
  { id: 'cockpit', icon: 'flight', label: 'Cockpit view' },
  { id: 'orbit', icon: '360', label: 'Orbit the aircraft' },
  { id: 'zoom-in', icon: 'add', label: 'Closer' },
  { id: 'zoom-out', icon: 'remove', label: 'Farther' },
  { id: 'recentre', icon: 'my_location', label: 'Recentre on the aircraft' },
  { id: 'stop', icon: 'close', label: 'Stop following' },
]);

const ORBIT_RATE = 0.0045; // radians per rendered tick

function el(doc, tag, props = {}, ...kids) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('aria-') || k === 'role' || k === 'type' || k === 'title' || k === 'placeholder' || k === 'autocomplete' || k === 'enterkeyhint' || k === 'src' || k === 'alt')
      node.setAttribute(k, v);
    else node[k] = v;
  }
  node.append(...kids);
  return node;
}

const icon = (doc, name) => el(doc, 'span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: name });

function readCollapsed(storage) {
  try {
    return storage?.getItem(BAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}
function writeCollapsed(storage, value) {
  try {
    storage?.setItem(BAR_COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    /* private mode: fine, it just isn't remembered */
  }
}

/**
 * @param {{ doc?: Document, win?: Window, viewer?: object, signal?: AbortSignal, storage?: Storage, voice?: () => any }} [opts]
 */
export function installOvercastCommandBar({
  doc = globalThis.document,
  win = globalThis,
  viewer = null,
  signal,
  storage = globalThis.localStorage,
  voice = () => win.__gevVoiceCommands,
} = {}) {
  if (!doc?.documentElement?.classList?.contains('overcast-embed')) return null;
  const opts = signal ? { signal } : undefined;

  // ── Command bar ──────────────────────────────────────────────────────────
  const mic = el(doc, 'button', { type: 'button', class: 'oc-cmd-mic', 'aria-label': 'Talk to the AI agent', 'aria-pressed': 'false', title: 'Talk to the AI agent' },
    el(doc, 'img', { src: '/globe/mic.svg', alt: '' }));
  const input = el(doc, 'input', { type: 'text', class: 'oc-cmd-input', placeholder: 'Ask or type a place…', 'aria-label': 'Type a command for the AI agent', autocomplete: 'off', enterkeyhint: 'send' });
  const send = el(doc, 'button', { type: 'submit', class: 'oc-cmd-send', 'aria-label': 'Send' }, icon(doc, 'send'));
  const hide = el(doc, 'button', { type: 'button', class: 'oc-cmd-hide', 'aria-label': 'Hide the command bar', title: 'Hide' }, icon(doc, 'expand_more'));
  const form = el(doc, 'form', { class: 'oc-cmd-form', role: 'search' }, input, send);
  const reply = el(doc, 'div', { id: 'oc-command-reply', role: 'status', 'aria-live': 'polite' });
  const bar = el(doc, 'div', { id: 'oc-command-bar' }, mic, form, hide);
  const show = el(doc, 'button', { type: 'button', id: 'oc-command-show', 'aria-label': 'Show the command bar', title: 'Show the AI agent' },
    el(doc, 'img', { src: '/globe/mic.svg', alt: '' }));
  doc.body.append(reply, bar, show);

  const setCollapsed = (value) => {
    doc.documentElement.classList.toggle('oc-command-collapsed', value);
    writeCollapsed(storage, value);
  };
  setCollapsed(readCollapsed(storage));
  hide.addEventListener('click', () => setCollapsed(true), opts);
  show.addEventListener('click', () => {
    setCollapsed(false);
    input.focus?.();
  }, opts);

  let replyTimer = null;
  const say = (text, hold = 9000) => {
    reply.textContent = text || '';
    reply.classList.toggle('visible', Boolean(text));
    clearTimeout(replyTimer);
    if (text && hold) replyTimer = setTimeout(() => reply.classList.remove('visible'), hold);
  };

  let unsubscribe = null;
  const attach = () => {
    const session = voice();
    if (!session?.subscribe || unsubscribe) return session || null;
    unsubscribe = session.subscribe((event) => {
      if (event.type === 'state') {
        bar.dataset.status = event.state;
        mic.setAttribute('aria-pressed', String(!['idle', 'error'].includes(event.state)));
        if (event.state === 'thinking') say(event.detail || 'Thinking…', 0);
        else if (event.state === 'error' && event.detail) say(event.detail);
      } else if (event.type === 'transcript' && event.role === 'assistant' && event.text) {
        say(event.text);
      }
    });
    return session;
  };
  // The voice commands start after this bar is built; attach when they exist.
  let tries = 0;
  const poll = setInterval(() => {
    if (attach() || ++tries > 60) clearInterval(poll);
  }, 500);
  poll.unref?.();
  signal?.addEventListener('abort', () => {
    clearInterval(poll);
    clearTimeout(replyTimer);
    unsubscribe?.();
  }, { once: true });

  mic.addEventListener('click', () => {
    const session = attach();
    if (!session) return say('The AI agent is still starting…');
    if (session.isActive?.()) session.stop?.();
    else session.start?.({ pushToTalk: false });
  }, opts);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = String(input.value || '').trim();
    if (!text) return;
    const session = attach();
    if (!session?.sendText) return say('The AI agent is still starting…');
    input.value = '';
    say('Thinking…', 0);
    session.sendText(text);
  }, opts);

  // ── Flight rail ──────────────────────────────────────────────────────────
  const buttons = {};
  const rail = el(doc, 'nav', { id: 'oc-flight-rail', 'aria-label': 'Flight controls' });
  for (const a of FLIGHT_ACTIONS) {
    const b = el(doc, 'button', { type: 'button', class: `oc-flight-${a.id}`, 'aria-label': a.label, title: a.label }, icon(doc, a.icon));
    buttons[a.id] = b;
    rail.append(b);
  }
  doc.body.append(rail);

  const inCockpit = () => doc.body.classList.contains('cockpit-mode');
  let orbiting = false;
  let removeTick = null;
  const setOrbit = (on) => {
    orbiting = on && Boolean(viewer?.trackedEntity);
    buttons.orbit.setAttribute('aria-pressed', String(orbiting));
    removeTick?.();
    removeTick = null;
    if (orbiting && viewer?.clock?.onTick?.addEventListener) {
      removeTick = viewer.clock.onTick.addEventListener(() => {
        if (!viewer.trackedEntity || inCockpit()) return setOrbit(false);
        viewer.camera.rotateRight(ORBIT_RATE);
        viewer.scene?.requestRender?.();
      });
    }
  };
  const sync = () => {
    const following = Boolean(viewer?.trackedEntity);
    const cockpit = inCockpit();
    doc.documentElement.classList.toggle('oc-flight-active', following || cockpit);
    doc.documentElement.classList.toggle('oc-flight-cockpit', cockpit);
    buttons.cockpit.setAttribute('aria-pressed', String(cockpit));
    buttons.cockpit.setAttribute('aria-label', cockpit ? 'Leave the cockpit' : 'Cockpit view');
    if (!following) setOrbit(false);
  };
  const range = () => {
    const p = viewer?.camera?.position;
    return p ? Math.hypot(p.x, p.y, p.z) : 0;
  };
  buttons.cockpit.addEventListener('click', () => {
    setOrbit(false);
    doc.getElementById(inCockpit() ? 'map-view-switch' : 'cockpit-entry')?.click();
  }, opts);
  buttons.orbit.addEventListener('click', () => setOrbit(!orbiting), opts);
  buttons['zoom-in'].addEventListener('click', () => {
    const r = range();
    if (r > 60) viewer.camera.zoomIn(r * 0.35);
    viewer?.scene?.requestRender?.();
  }, opts);
  buttons['zoom-out'].addEventListener('click', () => {
    const r = range();
    if (r) viewer.camera.zoomOut(r * 0.5);
    viewer?.scene?.requestRender?.();
  }, opts);
  buttons.recentre.addEventListener('click', () => {
    const e = viewer?.trackedEntity;
    if (!e) return;
    setOrbit(false);
    viewer.trackedEntity = undefined;
    viewer.trackedEntity = e;
  }, opts);
  buttons.stop.addEventListener('click', () => {
    setOrbit(false);
    // Escape is how the globe itself leaves the cockpit and stops following.
    const esc = () => doc.dispatchEvent(new (win.KeyboardEvent || Event)('keydown', { key: 'Escape', bubbles: true }));
    if (inCockpit()) esc();
    esc();
  }, opts);

  const offTracked = viewer?.trackedEntityChanged?.addEventListener?.(sync);
  win.addEventListener?.('gev:cockpit-mode-changed', sync, opts);
  signal?.addEventListener('abort', () => {
    setOrbit(false);
    offTracked?.();
  }, { once: true });
  sync();

  return { bar, rail, sync, setCollapsed, isOrbiting: () => orbiting };
}

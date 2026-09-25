/**
 * The embedded globe's AI agent and flight controls (Command Center,
 * /globe/?embed=1).
 *
 * Gary B, 25 Sep 2026: the mic "where they could talk to the screen" is on
 * the map by default and can be hidden; typing sits beside it; following a
 * plane brings flight controls (cockpit, orbit…) down the right side, in
 * thumb reach. Then, on the first design: keep the globe's own controls
 * where they were, and the talk control should not look like a chat box
 * ("so chatty … a textbook default") but like the globe's own AI AGENT
 * control, "similar to what was already there … with a little more pop".
 *
 * So this is the globe's AI AGENT control, lifted out of the settings drawer
 * onto the map as a compact pod, in the globe's own language (mono kicker,
 * segmented level meter, round mic with an orbit ring):
 *
 *   ( mic )  AI AGENT · READY              [keyboard] [hide]
 *            ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮
 *
 * - The mic is the hero: one tap to talk, tap again to stop. Listening, it
 *   fills with the accent and rings pulse out; the meter moves.
 * - Thinking, the meter gives way to what it heard ("› fly to Taiwan").
 * - The keyboard opens a type line in the same pod (send, or close to go
 *   back); with nothing typed, a few things the agent can do are offered.
 * - The answer appears above the pod, in the same card style as the map's
 *   own labels.
 * - Hide (or swipe the pod down) leaves only the mic, in the corner.
 *
 * Flight rail: Stop · Centre · Orbit · Cockpit as round buttons like the
 * globe's own, each labelled, on the right, only while an aircraft is
 * followed or you are in its cockpit (then Stop · Exit). The globe's own
 * top buttons stay where they are.
 *
 * The map credit (Cesium ion, Esri: required on screen) rides just above
 * the pod: the pod publishes its height as --oc-ask-h.
 *
 * Everything drives existing globe behaviour (the voice session in
 * window.__gevVoiceCommands, the globe's cockpit entry/exit buttons, Escape
 * to stop following, the tracked Cesium camera). Icons are inline SVG.
 * The full-screen globe (/globe/) is unchanged.
 */

export const BAR_COLLAPSED_KEY = 'oc-command-bar-collapsed';

/** Offered when the type line opens empty: things the agent can do. */
export const SUGGESTIONS = Object.freeze([
  'Fly to Taiwan',
  'Show military flights',
  'What am I looking at?',
  'Reset the view',
]);

/** Flight rail actions, top to bottom: the exit at the top, out of the
 *  thumb's way; the headline view (cockpit) at the bottom, nearest it.
 *  Exported for tests. */
export const FLIGHT_ACTIONS = Object.freeze([
  { id: 'stop', icon: 'close', label: 'Stop', title: 'Stop following' },
  { id: 'recentre', icon: 'recentre', label: 'Centre', title: 'Centre on the aircraft' },
  { id: 'orbit', icon: 'orbit', label: 'Orbit', title: 'Orbit the aircraft' },
  { id: 'cockpit', icon: 'cockpit', label: 'Cockpit', title: 'Cockpit view' },
]);

/** Pod status words, in the globe's AI AGENT style. Exported for tests. */
export const STATUS = Object.freeze({
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  error: 'Check mic',
});

/** 24-unit stroke icons (no icon font dependency). */
export const ICONS = Object.freeze({
  // The globe's own mic (public/mic.svg): capsule, grille, stand.
  mic: '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3M9 21h6"/><path d="M10.6 6.6h2.8M10.6 9h2.8M10.6 11.4h2.8" stroke-width="1.2" opacity=".7"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M9.5 10h.01M12.5 10h.01M15.5 10h.01M18 10h.01M6.5 13h.01M18 13h.01M9 14.5h6" stroke-width="2"/>',
  send: '<path d="M4.5 12h14"/><path d="m13 6.5 5.5 5.5-5.5 5.5"/>',
  hide: '<path d="m6 9.5 6 6 6-6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  stop: '<rect x="7.5" y="7.5" width="9" height="9" rx="1.8" fill="currentColor" stroke="none"/>',
  // An aircraft seen head-on from behind: the pilot's point of view.
  cockpit: '<circle cx="12" cy="13" r="2.6"/><path d="M2.5 13.5h7M14.5 13.5h7M12 10.4V5.5M9.5 18.5h5"/>',
  orbit: '<ellipse cx="12" cy="12" rx="9.5" ry="4.2"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="m17.8 5.6 2.1 2.6-3.2.7"/>',
  recentre: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
});

const METER_BARS = 15; // as the globe's own AI AGENT meter
const ORBIT_RATE = 0.0045; // radians per rendered tick
const SWIPE_HIDE_PX = 36;

function svgIcon(doc, name, size = 22) {
  const span = doc.createElement('span');
  span.className = `oc-icon oc-icon-${name}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

function el(doc, tag, props = {}, ...kids) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (/^(aria-|data-)|^(role|type|title|placeholder|autocomplete|enterkeyhint|inputmode|style)$/.test(k)) node.setAttribute(k, v);
    else node[k] = v;
  }
  node.append(...kids);
  return node;
}

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
  const root = doc.documentElement;
  const opts = signal ? { signal } : undefined;

  // ── The pod ──────────────────────────────────────────────────────────────
  const talk = el(doc, 'button', { type: 'button', class: 'oc-talk', 'aria-label': 'Talk to the AI agent', title: 'Talk' },
    el(doc, 'span', { class: 'oc-talk-orbit', 'aria-hidden': 'true' }),
    el(doc, 'span', { class: 'oc-talk-pulse', 'aria-hidden': 'true' }),
    svgIcon(doc, 'mic', 22), svgIcon(doc, 'stop', 20));

  const status = el(doc, 'span', { class: 'oc-pod-status', text: STATUS.idle });
  const meter = el(doc, 'span', { class: 'oc-pod-meter', 'aria-hidden': 'true' },
    ...Array.from({ length: METER_BARS }, (_, i) => el(doc, 'i', { style: `--bar:${i}` })));
  const heard = el(doc, 'span', { class: 'oc-pod-heard' });
  const readout = el(doc, 'span', { class: 'oc-pod-readout' },
    el(doc, 'span', { class: 'oc-pod-line' }, el(doc, 'span', { class: 'oc-pod-kicker', text: 'AI agent' }), status),
    meter, heard);

  const input = el(doc, 'input', {
    type: 'text', class: 'oc-ask-input', placeholder: 'Type a command', 'aria-label': 'Type a command for the AI agent',
    autocomplete: 'off', enterkeyhint: 'send', inputmode: 'text',
  });
  const send = el(doc, 'button', { type: 'submit', class: 'oc-send', 'aria-label': 'Send', title: 'Send' }, svgIcon(doc, 'send', 18));
  const form = el(doc, 'form', { class: 'oc-compose', role: 'search' }, input, send);

  const typeBtn = el(doc, 'button', { type: 'button', class: 'oc-type', 'aria-label': 'Type instead', title: 'Type' },
    svgIcon(doc, 'keyboard', 20), svgIcon(doc, 'close', 18));
  const hide = el(doc, 'button', { type: 'button', class: 'oc-ask-hide', 'aria-label': 'Hide the AI agent', title: 'Hide' }, svgIcon(doc, 'hide', 18));
  const pod = el(doc, 'div', { class: 'oc-pod', role: 'group', 'aria-label': 'AI agent' }, talk, readout, form, typeBtn, hide);

  const suggest = el(doc, 'div', { class: 'oc-ask-suggest', role: 'list', 'aria-label': 'Suggestions' },
    ...SUGGESTIONS.map((text) => el(doc, 'button', { type: 'button', class: 'oc-chip', role: 'listitem', text })));

  const answerAsked = el(doc, 'p', { class: 'oc-answer-asked' });
  const answerText = el(doc, 'p', { class: 'oc-answer-text' });
  const answerClose = el(doc, 'button', { type: 'button', class: 'oc-answer-close', 'aria-label': 'Dismiss answer' }, svgIcon(doc, 'close', 14));
  const answer = el(doc, 'section', { class: 'oc-answer', role: 'status', 'aria-live': 'polite' },
    el(doc, 'header', { class: 'oc-answer-head' }, el(doc, 'span', { class: 'oc-answer-kicker', text: 'AI agent' }), answerClose),
    answerAsked, answerText);

  const ask = el(doc, 'div', { id: 'oc-ask', dataset: { state: 'idle', compose: '0', typed: '0' } }, answer, suggest, pod);
  const orb = el(doc, 'button', { type: 'button', id: 'oc-ask-orb', 'aria-label': 'Show the AI agent', title: 'AI agent' },
    el(doc, 'span', { class: 'oc-talk-orbit', 'aria-hidden': 'true' }), svgIcon(doc, 'mic', 22));
  doc.body.append(ask, orb);

  let voiceState = 'idle';
  let composing = false;
  let answerTimer = null;
  let asked = ''; // the last thing said or typed, so the person sees it was heard

  // The map credit rides above the pod (overcast-embed.css): publish its
  // height, 0 while hidden, whenever it can change.
  const measure = () => {
    const hidden = root.classList.contains('oc-command-collapsed');
    const h = hidden ? 0 : Math.max(0, Math.round(Number(ask.offsetHeight) || 0));
    root.style?.setProperty?.('--oc-ask-h', `${h}px`);
  };
  const setState = () => {
    let s = 'idle';
    if (voiceState === 'listening' || voiceState === 'speaking') s = 'listening';
    else if (voiceState === 'thinking' || voiceState === 'connecting') s = 'thinking';
    else if (voiceState === 'error') s = 'error';
    ask.dataset.state = s;
    ask.dataset.compose = composing ? '1' : '0';
    ask.dataset.typed = String(input.value || '').trim() ? '1' : '0';
    status.textContent = STATUS[s];
    heard.textContent = s === 'thinking' && asked ? `› ${asked}` : '';
    const busy = s === 'listening' || s === 'thinking';
    talk.setAttribute('aria-label', busy ? 'Stop the AI agent' : 'Talk to the AI agent');
    talk.setAttribute('title', busy ? 'Stop' : 'Talk');
    talk.setAttribute('aria-pressed', String(s === 'listening'));
    typeBtn.setAttribute('aria-label', composing ? 'Close typing' : 'Type instead');
    typeBtn.setAttribute('title', composing ? 'Close' : 'Type');
    measure();
  };
  const showAnswer = (text, hold = 14000) => {
    answerText.textContent = text || '';
    answerAsked.textContent = text && asked ? asked : '';
    ask.classList.toggle('has-answer', Boolean(text));
    clearTimeout(answerTimer);
    if (text && hold) {
      answerTimer = setTimeout(() => {
        ask.classList.remove('has-answer');
        measure();
      }, hold);
    }
    measure();
  };
  const setCompose = (on) => {
    composing = Boolean(on);
    if (!composing) {
      input.value = '';
      input.blur?.();
    }
    setState();
    if (composing) input.focus?.();
  };
  const setCollapsed = (value) => {
    root.classList.toggle('oc-command-collapsed', value);
    writeCollapsed(storage, value);
    if (value && composing) setCompose(false);
    measure();
  };
  setCollapsed(readCollapsed(storage));
  const sizeWatch = win.ResizeObserver ? new win.ResizeObserver(measure) : null;
  sizeWatch?.observe(ask);

  let unsubscribe = null;
  const attach = () => {
    const session = voice();
    if (!session?.subscribe || unsubscribe) return session || null;
    unsubscribe = session.subscribe((event) => {
      if (event.type === 'state') {
        voiceState = event.state;
        if (event.state === 'error' && event.detail) showAnswer(event.detail);
        // No speech recognition here: say so, and open the type line.
        if (/type instead/i.test(String(event.detail || ''))) {
          showAnswer(event.detail);
          if (!composing) setCompose(true);
        }
        setState();
      } else if (event.type === 'transcript' && event.role === 'user' && event.text) {
        asked = String(event.text).trim().slice(0, 140);
        setState();
      } else if (event.type === 'transcript' && event.role === 'assistant' && event.text) {
        showAnswer(event.text);
      }
    });
    return session;
  };
  let tries = 0;
  const poll = setInterval(() => {
    if (attach() || ++tries > 60) clearInterval(poll);
  }, 500);
  poll.unref?.();

  const submit = (text) => {
    const said = String(text || '').trim();
    if (!said) return;
    const session = attach();
    if (!session?.sendText) return showAnswer('The AI agent is still starting…');
    asked = said.slice(0, 140);
    composing = false;
    input.value = '';
    input.blur?.();
    voiceState = 'thinking';
    setState();
    session.sendText(said);
  };

  talk.addEventListener('click', () => {
    const session = attach();
    if (!session) return showAnswer('The AI agent is still starting…');
    if (composing) setCompose(false);
    const s = ask.dataset.state;
    if (s === 'listening' || s === 'thinking' || session.isActive?.()) session.stop?.();
    else session.start?.({ pushToTalk: false });
  }, opts);
  typeBtn.addEventListener('click', () => setCompose(!composing), opts);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(input.value);
  }, opts);
  input.addEventListener('input', setState, opts);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setCompose(false);
  }, opts);
  for (const chip of suggest.children) chip.addEventListener('click', () => submit(chip.textContent), opts);
  answerClose.addEventListener('click', () => showAnswer(''), opts);
  hide.addEventListener('click', () => setCollapsed(true), opts);
  orb.addEventListener('click', () => setCollapsed(false), opts);
  // Swipe the pod down to hide it, as with any sheet.
  let touchY = null;
  pod.addEventListener('touchstart', (e) => { touchY = e.touches?.[0]?.clientY ?? null; }, { ...(opts || {}), passive: true });
  pod.addEventListener('touchend', (e) => {
    const y = e.changedTouches?.[0]?.clientY;
    if (touchY !== null && typeof y === 'number' && y - touchY > SWIPE_HIDE_PX) setCollapsed(true);
    touchY = null;
  }, opts);
  setState();

  // ── Flight rail ──────────────────────────────────────────────────────────
  const buttons = {};
  const rail = el(doc, 'nav', { id: 'oc-flight-rail', 'aria-label': 'Flight controls' });
  for (const a of FLIGHT_ACTIONS) {
    const label = el(doc, 'span', { class: 'oc-rail-label', text: a.label });
    const b = el(doc, 'button', { type: 'button', class: `oc-rail-btn oc-flight-${a.id}`, 'aria-label': a.title, title: a.title },
      el(doc, 'span', { class: 'oc-rail-disc' }, svgIcon(doc, a.icon, 18)), label);
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
    root.classList.toggle('oc-flight-active', following || cockpit);
    root.classList.toggle('oc-flight-cockpit', cockpit);
    buttons.cockpit.setAttribute('aria-pressed', String(cockpit));
    buttons.cockpit.setAttribute('aria-label', cockpit ? 'Leave the cockpit' : 'Cockpit view');
    buttons.cockpit.querySelector?.('.oc-rail-label')?.replaceChildren?.(cockpit ? 'Exit' : 'Cockpit');
    if (!following) setOrbit(false);
  };
  buttons.cockpit.addEventListener('click', () => {
    setOrbit(false);
    doc.getElementById(inCockpit() ? 'map-view-switch' : 'cockpit-entry')?.click();
  }, opts);
  buttons.orbit.addEventListener('click', () => setOrbit(!orbiting), opts);
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
    clearInterval(poll);
    clearTimeout(answerTimer);
    sizeWatch?.disconnect();
    unsubscribe?.();
    setOrbit(false);
    offTracked?.();
  }, { once: true });
  sync();

  return { ask, orb, rail, sync, setCollapsed, setCompose, showAnswer, isOrbiting: () => orbiting };
}

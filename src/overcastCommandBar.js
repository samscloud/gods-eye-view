/**
 * The embedded globe's on-screen controls (Command Center, /globe/?embed=1).
 *
 * Gary B, 25 Sep 2026: "we want that mic ... where they could talk to the
 * screen on the home screen as a default ... they can hide it", a box beside
 * it to type, and — while on a flight — the flight controls as icons down
 * the right side, in thumb reach. Then: "top tier design ... think through
 * it as a user."
 *
 * Designed from what a person does with the globe:
 *   1. look (the map stays clear),
 *   2. ask (one bar, always there: type or talk to the same AI agent),
 *   3. follow a plane (a labelled rail appears only then),
 *   4. adjust, rarely (settings sheet, behind the tools stack).
 *
 * Ask bar: [hide] Ask Overcast… [mic ↔ send]. The mic and send share one
 * place: an empty field offers the mic, a typed one offers send. Focusing an
 * empty field shows suggestions the agent can do. Talking shows a live
 * waveform; while the agent works the bar shows what it heard, and the
 * answer appears in a card above the bar under the question. Hidden (button
 * or swipe down), it folds to a single orb in the thumb corner.
 *
 * Flight rail: Stop · Centre · Orbit · Cockpit, each labelled, only while an
 * aircraft is followed or you are in its cockpit (then: Stop · Exit). It
 * stands in the bottom-right column, just above the bar's action button, in
 * thumb reach and clear of the aircraft's own label at the top. Pinch and
 * scroll already zoom, so there are no zoom buttons.
 *
 * The map credit (Cesium ion, Esri: required on screen) rides just above
 * the Ask stack: the bar publishes its height as --oc-ask-h.
 *
 * Everything drives existing globe behaviour (the voice session in
 * window.__gevVoiceCommands, the globe's cockpit entry/exit buttons, Escape
 * to stop following, the tracked Cesium camera). Icons are inline SVG.
 * The full-screen globe (/globe/) is unchanged.
 */

export const BAR_COLLAPSED_KEY = 'oc-command-bar-collapsed';

/** Suggestions offered on an empty, focused field: things the agent can do. */
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

/** 24-unit stroke icons, drawn for this bar (no icon font dependency). */
export const ICONS = Object.freeze({
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  send: '<path d="M12 19V5"/><path d="M5.5 11.5 12 5l6.5 6.5"/>',
  hide: '<path d="m6 9.5 6 6 6-6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor" stroke="none"/>',
  // An aircraft seen head-on from behind: the pilot's point of view.
  cockpit: '<circle cx="12" cy="13" r="2.6"/><path d="M2.5 13.5h7M14.5 13.5h7M12 10.4V5.5M9.5 18.5h5"/>',
  orbit: '<ellipse cx="12" cy="12" rx="9.5" ry="4.2"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="m17.8 5.6 2.1 2.6-3.2.7"/>',
  recentre: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
});

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
    else if (/^(aria-|data-)|^(role|type|title|placeholder|autocomplete|enterkeyhint|inputmode)$/.test(k)) node.setAttribute(k, v);
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

  // ── Ask bar ──────────────────────────────────────────────────────────────
  const hide = el(doc, 'button', { type: 'button', class: 'oc-ask-hide', 'aria-label': 'Hide the Ask bar', title: 'Hide' }, svgIcon(doc, 'hide', 20));
  const input = el(doc, 'input', {
    type: 'text', class: 'oc-ask-input', placeholder: 'Ask Overcast…', 'aria-label': 'Ask Overcast',
    autocomplete: 'off', enterkeyhint: 'send', inputmode: 'text',
  });
  const wave = el(doc, 'span', { class: 'oc-ask-wave', 'aria-hidden': 'true' },
    ...Array.from({ length: 5 }, () => el(doc, 'i')));
  const live = el(doc, 'span', { class: 'oc-ask-live', text: 'Listening…' });
  const field = el(doc, 'span', { class: 'oc-ask-field' }, input, wave, live);
  const action = el(doc, 'button', { type: 'button', class: 'oc-ask-action', 'aria-label': 'Talk to Overcast', title: 'Talk' },
    svgIcon(doc, 'mic', 20), svgIcon(doc, 'send', 20), svgIcon(doc, 'stop', 20));
  const form = el(doc, 'form', { class: 'oc-ask-bar', role: 'search' }, hide, field, action);

  const suggest = el(doc, 'div', { class: 'oc-ask-suggest', role: 'list', 'aria-label': 'Suggestions' },
    ...SUGGESTIONS.map((text) => el(doc, 'button', { type: 'button', class: 'oc-chip', role: 'listitem', text })));

  const answerAsked = el(doc, 'p', { class: 'oc-answer-asked' });
  const answerText = el(doc, 'p', { class: 'oc-answer-text' });
  const answerClose = el(doc, 'button', { type: 'button', class: 'oc-answer-close', 'aria-label': 'Dismiss answer' }, svgIcon(doc, 'close', 16));
  const answer = el(doc, 'section', { class: 'oc-answer', role: 'status', 'aria-live': 'polite' },
    el(doc, 'header', { class: 'oc-answer-head' }, el(doc, 'span', { class: 'oc-answer-kicker', text: 'Overcast' }), answerClose),
    answerAsked, answerText);

  const ask = el(doc, 'div', { id: 'oc-ask', dataset: { state: 'idle' } }, answer, suggest, form);
  const orb = el(doc, 'button', { type: 'button', id: 'oc-ask-orb', 'aria-label': 'Show the Ask bar', title: 'Ask Overcast' }, svgIcon(doc, 'mic', 22));
  doc.body.append(ask, orb);

  let voiceState = 'idle';
  let answerTimer = null;
  let asked = ''; // the last thing said or typed, so the person sees it was heard
  // The map credit rides above the Ask stack (overcast-embed.css): publish
  // the stack's height, 0 while hidden, whenever it can change.
  const measure = () => {
    const hidden = root.classList.contains('oc-command-collapsed');
    const h = hidden ? 0 : Math.max(0, Math.round(Number(ask.offsetHeight) || 0));
    root.style?.setProperty?.('--oc-ask-h', `${h}px`);
  };
  const setState = () => {
    const typed = String(input.value || '').trim().length > 0;
    let s = 'idle';
    if (voiceState === 'listening' || voiceState === 'speaking') s = 'listening';
    else if (voiceState === 'thinking' || voiceState === 'connecting') s = 'thinking';
    else if (typed) s = 'typing';
    else if (ask.dataset.focus === '1') s = 'focus';
    ask.dataset.state = s;
    const labels = { listening: ['Stop listening', 'Stop'], typing: ['Send', 'Send'], thinking: ['Stop', 'Stop'] };
    const [label, title] = labels[s] || ['Talk to Overcast', 'Talk'];
    action.setAttribute('aria-label', label);
    action.setAttribute('title', title);
    live.textContent = s === 'thinking' ? (asked ? `“${asked}”` : 'Thinking…') : 'Listening…';
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
  const setCollapsed = (value) => {
    root.classList.toggle('oc-command-collapsed', value);
    writeCollapsed(storage, value);
    if (value) input.blur?.();
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
    input.value = '';
    input.blur?.();
    ask.dataset.focus = '0';
    asked = said.slice(0, 140);
    voiceState = 'thinking';
    setState();
    session.sendText(said);
  };

  action.addEventListener('click', () => {
    const s = ask.dataset.state;
    if (s === 'typing') return submit(input.value);
    const session = attach();
    if (!session) return showAnswer('The AI agent is still starting…');
    if (s === 'listening' || s === 'thinking' || session.isActive?.()) session.stop?.();
    else session.start?.({ pushToTalk: false });
  }, opts);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(input.value);
  }, opts);
  input.addEventListener('input', setState, opts);
  input.addEventListener('focus', () => {
    ask.dataset.focus = '1';
    setState();
  }, opts);
  input.addEventListener('blur', () => {
    // Let a tap on a suggestion land before the row goes away.
    setTimeout(() => {
      ask.dataset.focus = '0';
      setState();
    }, 160);
  }, opts);
  for (const chip of suggest.children) chip.addEventListener('click', () => submit(chip.textContent), opts);
  answerClose.addEventListener('click', () => showAnswer(''), opts);
  hide.addEventListener('click', () => setCollapsed(true), opts);
  orb.addEventListener('click', () => {
    setCollapsed(false);
    input.focus?.();
  }, opts);
  // Swipe the bar down to hide it, as with any sheet.
  let touchY = null;
  form.addEventListener('touchstart', (e) => { touchY = e.touches?.[0]?.clientY ?? null; }, { ...(opts || {}), passive: true });
  form.addEventListener('touchend', (e) => {
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
    const b = el(doc, 'button', { type: 'button', class: `oc-rail-btn oc-flight-${a.id}`, 'aria-label': a.title, title: a.title }, svgIcon(doc, a.icon, 22), label);
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

  return { ask, orb, rail, sync, setCollapsed, showAnswer, isOrbiting: () => orbiting };
}

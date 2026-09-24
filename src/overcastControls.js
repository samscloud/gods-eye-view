/**
 * Globe controls drawer for the Command Center embed (/globe/?embed=1).
 *
 * Gary B, 24 Sep 2026 (phone screenshot): inside the Command Center the
 * globe's own panels (Scenes, CCTV, Display, Context) and the
 * command dock (location, AI agent, presets) covered the map. They are
 * settings, not the picture, so in the embed they live behind one button in
 * the top action row, next to share / tilt / north / globe, and open when
 * needed: a bottom sheet on phones, a left drawer on wider panels.
 *
 * The panels are moved, not rebuilt: the same elements, listeners and layout
 * controllers keep working inside the drawer. The full-screen globe (/globe/)
 * is unchanged.
 */

export const CONTROLS_OPEN_CLASS = 'oc-controls-open';

/** Elements that move into the drawer, in display order. Exported for tests. */
export const DRAWER_SECTIONS = Object.freeze([
  'left-panel-stack', // Scenes, CCTV (Data Layers is hidden: the host chooses layers)
  'right-context-rail', // Display, Context
]);
/** The command dock (Location, AI agent, Presets) pins to the drawer's foot:
 *  its Location and Presets trays open upward over the drawer, as they do
 *  over the map, so it must not sit inside the scrolling body. */
export const DRAWER_FOOTER = 'command-dock';

/**
 * Install the drawer. No-op outside the embed.
 * @param {{ doc?: Document, signal?: AbortSignal }} [opts]
 * @returns {{ open: () => void, close: () => void, toggle: () => void, isOpen: () => boolean } | null}
 */
export function installOvercastControls({ doc = globalThis.document, signal } = {}) {
  const root = doc?.documentElement;
  if (!root?.classList?.contains('overcast-embed')) return null;
  const button = doc.getElementById('globe-controls-toggle');
  if (!button) return null;

  const backdrop = doc.createElement('div');
  backdrop.id = 'oc-controls-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  const sheet = doc.createElement('section');
  sheet.id = 'oc-controls-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'false');
  sheet.setAttribute('aria-labelledby', 'oc-controls-title');

  const header = doc.createElement('header');
  header.className = 'oc-controls-header';
  const grip = doc.createElement('span');
  grip.className = 'oc-controls-grip';
  grip.setAttribute('aria-hidden', 'true');
  const title = doc.createElement('h2');
  title.id = 'oc-controls-title';
  title.textContent = 'Globe controls';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'oc-controls-close';
  close.setAttribute('aria-label', 'Close globe controls');
  const closeIcon = doc.createElement('span');
  closeIcon.className = 'material-symbols-outlined';
  closeIcon.setAttribute('aria-hidden', 'true');
  closeIcon.textContent = 'close';
  close.append(closeIcon);
  header.append(grip, title, close);

  const body = doc.createElement('div');
  body.className = 'oc-controls-body';
  for (const id of DRAWER_SECTIONS) {
    const el = doc.getElementById(id);
    if (el) body.append(el);
  }
  const footer = doc.createElement('div');
  footer.className = 'oc-controls-footer';
  const dock = doc.getElementById(DRAWER_FOOTER);
  if (dock) footer.append(dock);
  sheet.append(header, body, footer);
  doc.body.append(backdrop, sheet);

  button.setAttribute('aria-controls', sheet.id);
  button.setAttribute('aria-expanded', 'false');

  const isOpen = () => root.classList.contains(CONTROLS_OPEN_CLASS);
  const setOpen = (next) => {
    root.classList.toggle(CONTROLS_OPEN_CLASS, next);
    // Closed: off-screen (CSS transition) and inert, so it neither takes
    // focus nor clicks; open: a normal, focusable region.
    sheet.inert = !next;
    sheet.setAttribute('aria-hidden', String(!next));
    button.setAttribute('aria-expanded', String(next));
    button.setAttribute('aria-pressed', String(next));
    // Panels measure themselves on resize; let them re-lay out in the drawer.
    globalThis.dispatchEvent?.(new Event('resize'));
  };
  const api = {
    open: () => setOpen(true),
    close: () => {
      const wasOpen = isOpen();
      setOpen(false);
      if (wasOpen) button.focus?.();
    },
    toggle: () => (isOpen() ? api.close() : api.open()),
    isOpen,
  };

  const opts = signal ? { signal } : undefined;
  button.addEventListener('click', api.toggle, opts);
  close.addEventListener('click', api.close, opts);
  backdrop.addEventListener('click', api.close, opts);
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && isOpen()) api.close();
    },
    opts,
  );
  setOpen(false);
  return api;
}

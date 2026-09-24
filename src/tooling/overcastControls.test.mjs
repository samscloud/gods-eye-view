import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTROLS_OPEN_CLASS, DRAWER_FOOTER, DRAWER_SECTIONS, installOvercastControls } from '../overcastControls.js';

/** Just enough DOM for the drawer: ids, classes, attributes, children, events. */
function fakeDom({ embed = true } = {}) {
  const byId = new Map();
  const listeners = new Map();
  const make = (tag, id) => {
    const classes = new Set();
    const attrs = new Map();
    const own = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      parent: null,
      inert: false,
      textContent: '',
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c), classes.has(c)),
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      append: (...kids) => {
        for (const k of kids) {
          if (k.parent) k.parent.children.splice(k.parent.children.indexOf(k), 1);
          k.parent = el;
          el.children.push(k);
        }
      },
      addEventListener: (type, fn) => own.set(type, fn),
      fire: (type, event = {}) => own.get(type)?.(event),
      focus: () => { el.focused = true; },
      set id(v) { if (v) byId.set(v, el); this._id = v; },
      get id() { return this._id; },
    };
    if (id) el.id = id;
    return el;
  };
  const documentElement = make('html');
  if (embed) documentElement.classList.add('overcast-embed');
  const body = make('body');
  const doc = {
    documentElement,
    body,
    createElement: (tag) => make(tag),
    getElementById: (id) => byId.get(id) || null,
    addEventListener: (type, fn) => listeners.set(type, fn),
    key: (key) => listeners.get('keydown')?.({ key }),
  };
  const button = make('button', 'globe-controls-toggle');
  body.append(button);
  for (const id of [...DRAWER_SECTIONS, DRAWER_FOOTER]) body.append(make('div', id));
  return { doc, button };
}

test('outside the embed nothing moves (the full-screen globe keeps its layout)', () => {
  const { doc } = fakeDom({ embed: false });
  assert.equal(installOvercastControls({ doc }), null);
  assert.equal(doc.getElementById('left-panel-stack').parent, doc.body);
});

test('the embed moves the panels and dock into a closed drawer behind the button', () => {
  const { doc, button } = fakeDom();
  const api = installOvercastControls({ doc });
  const sheet = doc.getElementById('oc-controls-sheet');
  assert.ok(sheet, 'drawer created');
  const [header, body, footer] = sheet.children;
  assert.deepEqual(body.children.map((c) => c.id), [...DRAWER_SECTIONS]);
  assert.deepEqual(footer.children.map((c) => c.id), [DRAWER_FOOTER]);
  assert.equal(api.isOpen(), false, 'the map starts clear');
  assert.equal(sheet.inert, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.ok(header.children.some((c) => c.getAttribute?.('aria-label') === 'Close globe controls'));
});

test('the button toggles it; close, Escape and the backdrop dismiss it', () => {
  const { doc, button } = fakeDom();
  const api = installOvercastControls({ doc });
  const sheet = doc.getElementById('oc-controls-sheet');
  button.fire('click');
  assert.equal(api.isOpen(), true);
  assert.equal(doc.documentElement.classList.contains(CONTROLS_OPEN_CLASS), true);
  assert.equal(sheet.inert, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  doc.key('Escape');
  assert.equal(api.isOpen(), false);
  assert.equal(button.focused, true, 'focus returns to the button');
  button.fire('click');
  doc.getElementById('oc-controls-backdrop').fire('click');
  assert.equal(api.isOpen(), false);
});

test('the drawer is styled for phones (bottom sheet) and wide panels (left drawer), embed only', () => {
  const css = readFileSync(new URL('../ui/styles/overcast-embed.css', import.meta.url), 'utf8');
  assert.match(css, /html:not\(\.overcast-embed\) #globe-controls-toggle \{\s*display: none !important;/);
  assert.match(css, /@media \(max-width: 720px\)[^{]*\{\s*#oc-controls-sheet \{[^}]*border-radius: 16px 16px 0 0;/);
  assert.match(css, /text-size-adjust: 100%/);
  const html = readFileSync(new URL('../ui/templates/scene-chrome.html', import.meta.url), 'utf8');
  assert.match(html, /id="globe-controls-toggle"[\s\S]*?>tune</);
});

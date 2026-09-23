/**
 * Layers the Overcast server does not serve yet. They stay registered (other
 * modules reference them) but are hidden from the Data Layers menu and refuse
 * to enable, so nothing on the globe points at an endpoint that answers 404.
 * Each id comes off this list in the PR that gives it an Overcast source.
 */
export const OVERCAST_UNAVAILABLE_LAYERS = Object.freeze(
  new Set([
    'satellites',
    'rocket-launches',
    'traffic',
    'transit',
    'bikeshare',
    'radio',
    'directions',
    'alpr-cameras',
    'military-installations',
    'local-firms',
  ]),
);

export function isOvercastUnavailable(layerId) {
  return OVERCAST_UNAVAILABLE_LAYERS.has(String(layerId || ''));
}

/**
 * Gate a layer manager instance: unavailable layers never turn on and never
 * appear in the Data Layers menu. Applied at app composition (src/app/data.js)
 * so the lifecycle itself stays upstream-identical.
 */
export function gateUnavailableLayers(manager, unavailable = OVERCAST_UNAVAILABLE_LAYERS) {
  const has = (id) => unavailable.has(String(id || ''));
  const intent = manager._setEnabledWithIntent.bind(manager);
  manager._setEnabledWithIntent = (layerId, shouldEnable, options) =>
    shouldEnable && has(layerId)
      ? { intentEpoch: null, promise: Promise.resolve(false) }
      : intent(layerId, shouldEnable, options);
  const getAll = manager.getAll.bind(manager);
  manager.getAll = () =>
    getAll().map((row) => (has(row.id) ? { ...row, showInTogglePanel: false } : row));
  return manager;
}

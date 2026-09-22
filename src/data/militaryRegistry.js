import { createMilitaryRegistry } from '../layers/aircraft/classification.js';
import { createOvercastAircraftSource } from '../sources/live/overcast.js';

const registry = createMilitaryRegistry({ source: createOvercastAircraftSource({ scope: 'mil' }) });
export const isMilitaryLayerActive = registry.isMilitaryLayerActive;
export const setMilitaryLayerActive = registry.setMilitaryLayerActive;
export const onMilitaryLayerActiveChange = registry.onMilitaryLayerActiveChange;
export const registerMilitaryIcaos = registry.registerMilitaryIcaos;
export const isMilitaryIcao = registry.isMilitaryIcao;
export const refreshMilitaryRegistryIfStale =
  registry.refreshMilitaryRegistryIfStale;

/** Configure classification from the same source used by the aircraft layer. */
export const configureMilitaryRegistrySource = registry.configureSource;

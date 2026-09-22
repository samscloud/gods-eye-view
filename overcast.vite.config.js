// Overcast build of the globe. Served by the Overcast server under /globe/;
// the Overcast Express server mounts the provider middleware, not Vite.
import { createBrowserViteConfig } from './build/vite.js';

const cfg = createBrowserViteConfig({ cesiumToken: process.env.CESIUM_ION_TOKEN });

export default {
  ...cfg,
  base: '/globe/',
  build: { ...cfg.build, outDir: process.env.GLOBE_OUT_DIR || 'dist-overcast', emptyOutDir: true },
};

import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages).
  base: "./",
  build: {
    // Cytoscape alone is ~430 kB minified; the app is one screen, so splitting gains little.
    chunkSizeWarningLimit: 800,
  },
});

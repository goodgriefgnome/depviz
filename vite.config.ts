import { defineConfig } from "vite";

export default defineConfig({
  // Served from https://goodgriefgnome.github.io/depviz/ (GitHub Pages for this repo).
  base: "/depviz/",
  build: {
    // Cytoscape alone is ~430 kB minified; the app is one screen, so splitting gains little.
    chunkSizeWarningLimit: 800,
  },
});

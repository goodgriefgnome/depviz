# depviz

An interactive dependency graph viewer that runs entirely in the browser.
Modules are grouped into their folders. Folders can be collapsed into a single
box, and the imports in and out of them merge into one arrow with a count.
Nodes can be dragged, and the layout is remembered.

**Status:** early. The data model is in place; importers and the viewer are next.

## Loading a graph (planned)

- **A public GitHub repo URL.** JavaScript files are read in the browser and
  their `import` / `require` statements resolved to files.
- **A graph file you already have**, pasted or dropped in:
  - **DOT** (Graphviz). Most dependency tools can emit it, e.g.
    `madge --dot`, `depcruise -T dot`, `pydeps --show-dot`, `cargo-depgraph`.
  - **GraphML**
  - **JSON Graph Format** (also the app's own save format)

## How folders are worked out

Each node either names its `parent` explicitly (DOT `subgraph cluster_*`
blocks, nested GraphML graphs, a `parent` field in JSON), or the folder tree is
inferred from `/` in its id: `src/lib/api/client.js` lands in
`src/` → `lib/` → `api/`. Chains of folders that hold only a single folder
(e.g. `home/me/project/`) are merged into one.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run build      # type-check and build to dist/
```

Source layout:

- `src/model/` – the graph types, folder tree builder and cycle detection.

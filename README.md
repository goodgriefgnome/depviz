# depviz

An interactive dependency graph viewer that runs entirely in the browser.
Modules are grouped into their folders. Folders can be collapsed into a single
box, and the imports in and out of them merge into one arrow with a count.
Nodes can be dragged, and the layout is remembered.

**Status:** early. The data model and the DOT importer are in place; the viewer is next.

## Loading a graph

- **A DOT (Graphviz) file** you already have, pasted or dropped in. Most
  dependency tools can emit one, e.g. `depcruise --no-config -T dot src`,
  `madge --dot src/main.js`, `pydeps --show-dot`, `cargo-depgraph`.
- *(Planned)* **A public GitHub repo URL.** JavaScript files are read in the
  browser and their `import` / `require` statements resolved to files.

### How DOT is read

- Nodes and edges are taken as they are; attributes are kept as metadata,
  and a node's `label` (plain or HTML) becomes its display name.
- `subgraph cluster_*` blocks become folders. A node belongs to the cluster
  that mentions it, and a repeated cluster name reopens the same cluster, as
  in Graphviz. Other subgraphs (`{ rank=same; … }`) don't affect grouping.
- Edge chains (`a -> b -> c`) and groups (`a -> {b c}`) become single edges.
  Ports (`a:p`) are dropped, and repeated edges are merged.
- In an undirected `graph`, edges point left to right as written.
- Not supported: string concatenation (`"a" + "b"`), several graphs in one
  file, and `subgraph` blocks used as an edge endpoint (`{a b} -> c` works).

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
- `src/importers/` – file format readers (DOT so far).

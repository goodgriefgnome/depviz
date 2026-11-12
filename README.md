# depviz

An interactive dependency graph viewer that runs entirely in the browser.
Modules are grouped into their folders. Folders can be collapsed into a single
box, and the imports in and out of them merge into one arrow with a count.
Nodes can be dragged, and the layout is remembered.

**Status:** early but usable: open a JavaScript/TypeScript project or a DOT
file and explore it.

## Using it

Run `npm run dev` (or open a build), then drop a project folder, a zip or
tarball of one, or a DOT file on the page. You can also choose one, paste DOT,
or try the sample.

- Drag modules or whole folders. Positions and collapsed folders are kept in
  your browser, per graph, and the last file opened comes back on reload.
- Double-click a folder to collapse it into one box; arrows into and out of it
  merge, with a count. **Depth** collapses every folder at one level.
- Click a module or folder to highlight what it depends on (blue) and what
  depends on it (orange). Click an arrow to see the dependencies it stands for.
- Three layouts (computed by ELK in a web worker): **Layered**, **By folder**
  and **Organic**. With **Re-arrange on collapse** off, your own placement is
  kept when folders collapse or expand.
- Import cycles are drawn as red dashed arrows.

## Loading a graph

- **A JavaScript or TypeScript project**: a folder, or a `.zip`, `.tar` or
  `.tar.gz` of one. For a GitHub repo, use **Code → Download ZIP** and drop
  the zip in. Everything is read in the browser; nothing is uploaded.
- **A DOT (Graphviz) file** you already have, pasted or dropped in. Most
  dependency tools can emit one, e.g. `depcruise --no-config -T dot src`,
  `madge --dot src/main.js`, `pydeps --show-dot`, `cargo-depgraph`.
- *(Planned)* **A public GitHub repo URL.** Browsers can't download a repo zip
  from GitHub directly (`codeload.github.com` doesn't allow it), so this would
  fetch files one by one through the GitHub API.

### How a project is read

- Each `.js .jsx .ts .tsx .mjs .cjs .mts .cts` file is a module (not `.d.ts`
  or `.min.js`, and nothing over 1 MB). `node_modules`, `.git`, `dist`,
  `build`, `coverage` and similar folders are skipped.
- `import … from`, `import "…"`, `export … from`, `import()` with a string,
  and `require()` with a string each add an arrow to the file they name.
  Comments, strings, template literals and regexes are skipped, so code that
  only mentions an import doesn't count.
- Specifiers are resolved like bundlers do: relative paths with or without an
  extension, `index` files, `.js` written for a `.ts` file, tsconfig/jsconfig
  `paths` and `baseUrl` (with relative `extends`), and imports of other
  packages in the same repo by their `package.json` name. Imports of
  installed packages, and aliases set only in a bundler config, are left out.
  Relative imports that point at missing files are listed under **Notes from
  loading**.
- Test files (`*.test.*`, `*.spec.*`, and files under `test/`, `tests/`,
  `spec/`, `__tests__/`, `__mocks__/`) are hidden until you tick **Show
  tests**. That works for DOT graphs with path-like ids too.

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

Live at **https://goodgriefgnome.github.io/depviz/**. Every push to `main` runs
the tests, builds, and deploys there (`.github/workflows/deploy.yml`).

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
- `src/project/` – reading a project: zip/tar unpacking, folder reading, the
  import scanner, and import resolution.
- `src/view/` – the view model (collapsing, merged arrows, saved positions),
  ELK layouts, and the Cytoscape graph view.
- `src/ui/` – the side panel and the open screen. `src/app.ts` wires it all up.

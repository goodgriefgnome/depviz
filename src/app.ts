import { parseDot } from "./importers/dot";
import { ImportError } from "./importers/types";
import { buildHierarchy } from "./model/hierarchy";
import { countTests, withoutTests } from "./model/tests";
import type { DepGraph } from "./model/types";
import { analyseProject, type ProjectInput } from "./project";
import sampleDot from "./sample/acme-shop.dot?raw";
import * as storage from "./storage";
import { h } from "./ui/dom";
import { Loader } from "./ui/loader";
import { renderPanel } from "./ui/panel";
import { GraphView, plural, type Selection } from "./view/graphView";
import { LAYOUT_NAMES, type LayoutName } from "./view/layout";
import { ViewModel } from "./view/model";

/** Start views at the deepest folder level that shows at most this many boxes. */
const START_BOXES = 30;
const HUD_IDLE = "Double-click a folder to collapse or expand it · scroll to zoom";

export function startApp(root: HTMLElement): void {
  const prefs = storage.loadPrefs();
  let layout: LayoutName = prefs.layout && prefs.layout in LAYOUT_NAMES ? prefs.layout : "layered";
  let autoArrange = prefs.autoArrange ?? true;
  let showTests = prefs.showTests ?? false;
  let key = "";
  /** The graph as loaded, tests included; what's shown may leave them out. */
  let graph: DepGraph | undefined;
  let graphName = "";
  let importWarnings: string[] = [];
  let warnings: string[] = [];
  let selection: Selection = null;
  let busy = false;
  let hoverText: string | null = null;

  // ----- Toolbar -----
  const title = h("span", { class: "proj" });
  const matches = h("span", { class: "matches", "aria-live": "polite" });
  const search = h("input", { id: "q", class: "search", type: "search", placeholder: "Find module…", autocomplete: "off", "aria-label": "Find module" });
  const levels = h("div", { class: "seg", role: "group", "aria-label": "Folder depth" });
  const layoutSeg = h(
    "div",
    { class: "seg", role: "group", "aria-label": "Layout" },
    ...(Object.keys(LAYOUT_NAMES) as LayoutName[]).map((name) =>
      h("button", { type: "button", "data-layout": name, onclick: () => setLayout(name) }, LAYOUT_NAMES[name]),
    ),
  );
  const auto = h("input", { id: "auto", type: "checkbox" });
  const testsBox = h("input", { id: "tests", type: "checkbox" });
  const testsCount = h("span", { class: "muted" });
  const testsToggle = h("label", { class: "toggle", for: "tests", hidden: true }, testsBox, "Show tests", testsCount);
  const toolbar = h(
    "header",
    { class: "bar" },
    h("div", { class: "brand" }, h("h1", {}, "depviz"), title),
    h("div", { class: "ctl" }, matches, search, h("button", { class: "btn", type: "button", onclick: () => openLoader() }, "Open…")),
    h("div", { class: "break" }),
    h("div", { class: "ctl" }, h("span", { class: "lbl" }, "Depth"), levels),
    h(
      "div",
      { class: "ctl" },
      h("span", { class: "lbl" }, "Layout"),
      layoutSeg,
      h("button", { class: "btn", type: "button", onclick: () => void view.relayout() }, "Re-run"),
      h("button", { class: "btn", type: "button", onclick: () => view.fit() }, "Fit"),
    ),
    h("label", { class: "toggle", for: "auto" }, auto, "Re-arrange on collapse"),
    testsToggle,
  );

  // ----- Stage and panel -----
  const canvas = h("div", { id: "cy", "aria-label": "Dependency graph" });
  const hud = h("div", { class: "hud" });
  const stage = h("div", { class: "stage" }, canvas, hud);
  const panel = h("aside", { class: "panel", "aria-live": "polite" });
  const work = h("main", { class: "work" }, stage, panel);

  const loader = new Loader({
    load: (text, name) => load(text, name),
    loadProject: (project) => loadProject(project),
    loadSample: () => {
      load(sampleDot, "acme-shop.dot (sample)");
    },
    close: () => {
      loader.hide();
    },
  });

  root.replaceChildren(toolbar, work, loader.el);
  loader.attachDropTarget(document.body);

  const view = new GraphView(canvas, {
    onSelect(sel) {
      selection = sel;
      drawPanel();
    },
    onChange: () => scheduleSave(),
    onHover(text) {
      hoverText = text;
      drawHud();
    },
    onBusy(b) {
      busy = b;
      drawHud();
    },
  });
  view.layoutName = layout;
  view.autoArrange = autoArrange;

  // ----- Actions -----
  /** Opens DOT text. Returns an error message, or null on success. */
  function load(text: string, name: string): string | null {
    let result;
    try {
      result = parseDot(text);
    } catch (err) {
      return err instanceof ImportError ? err.message : `Something went wrong reading the file: ${String(err)}`;
    }
    const error = open(result.graph, result.warnings, name);
    if (!error) storage.saveLastFile({ name, text });
    return error;
  }

  /** Opens a folder or archive's files. Returns an error message, or null on success. */
  function loadProject(project: ProjectInput): string | null {
    let result;
    try {
      result = analyseProject(project);
    } catch (err) {
      return err instanceof ImportError ? err.message : `Something went wrong reading the project: ${String(err)}`;
    }
    const error = open(result.graph, result.warnings, project.name);
    if (!error) storage.saveLastFile({ name: project.name, graph: result.graph, warnings: result.warnings });
    return error;
  }

  function open(g: DepGraph, notes: string[], name: string): string | null {
    if (g.nodes.length === 0 && g.edges.length === 0) return "The graph has no nodes.";
    graph = g;
    graphName = name;
    importWarnings = notes;
    show();
    loader.hide();
    return null;
  }

  /** Shows the loaded graph, with or without tests, restoring its saved view. */
  function show(): void {
    if (!graph) return;
    const tests = countTests(graph);
    const shown = tests && !showTests ? withoutTests(graph) : graph;
    // A graph that is all tests is shown with them rather than empty.
    const hierarchy = buildHierarchy(shown.nodes.length ? shown : graph);
    warnings = [...importWarnings, ...hierarchy.warnings];
    key = storage.graphKey(hierarchy);
    const saved = storage.loadView(key);
    const vm = new ViewModel(hierarchy, saved);
    if (!saved) vm.setLevel(vm.pickLevel(START_BOXES));
    const label = graph.label ?? graphName;
    title.textContent = label;
    document.title = `${label} · depviz`;
    search.value = "";
    matches.textContent = "";
    testsToggle.hidden = tests === 0;
    testsCount.textContent = `(${tests.toLocaleString()})`;
    view.setModel(vm);
    syncControls();
  }

  function openLoader(): void {
    loader.show(view.model !== undefined);
  }

  function setLayout(name: LayoutName): void {
    layout = name;
    view.layoutName = name;
    savePrefs();
    syncControls();
    void view.relayout();
  }

  function setLevel(level: number | null): void {
    view.setLevel(level);
    syncControls();
  }

  const panelActions = {
    reveal: (id: string) => view.reveal(id),
    toggle: (id: string) => {
      view.toggle(id);
      syncControls();
    },
    resetLayout: () => {
      const vm = view.model;
      if (!vm) return;
      storage.clearView(key);
      const fresh = new ViewModel(vm.h);
      fresh.setLevel(fresh.pickLevel(START_BOXES));
      view.setModel(fresh);
      syncControls();
    },
  };

  // ----- Rendering of chrome -----
  function syncControls(): void {
    const vm = view.model;
    for (const b of layoutSeg.querySelectorAll<HTMLButtonElement>("[data-layout]")) b.setAttribute("aria-pressed", String(b.dataset.layout === layout));
    auto.checked = autoArrange;
    testsBox.checked = showTests;
    levels.replaceChildren();
    if (!vm || vm.maxContainerDepth < 0) {
      levels.append(h("span", { class: "lbl muted" }, "no folders"));
      return;
    }
    const current = vm.currentLevel();
    const deepest = Math.min(vm.maxContainerDepth, 7);
    for (let l = 0; l <= deepest; l++) {
      levels.append(
        h(
          "button",
          { type: "button", title: `Collapse folders at depth ${l + 1}`, "aria-pressed": String(current === l), onclick: () => setLevel(l) },
          String(l + 1),
        ),
      );
    }
    levels.append(h("button", { type: "button", title: "Expand every folder", "aria-pressed": String(current === null), onclick: () => setLevel(null) }, "All"));
  }

  function drawPanel(): void {
    renderPanel(panel, view, selection, warnings, panelActions);
    syncControls();
  }

  function drawHud(): void {
    hud.textContent = hoverText ?? (busy ? "Arranging…" : HUD_IDLE);
  }

  let saveTimer: number | undefined;
  function scheduleSave(): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const vm = view.model;
      if (vm) storage.saveView(key, vm.save());
    }, 300);
  }

  function savePrefs(): void {
    storage.savePrefs({ layout, autoArrange, showTests });
  }

  // ----- Wiring -----
  auto.addEventListener("change", () => {
    autoArrange = auto.checked;
    view.autoArrange = autoArrange;
    savePrefs();
    if (autoArrange) void view.relayout();
  });
  testsBox.addEventListener("change", () => {
    showTests = testsBox.checked;
    savePrefs();
    show();
  });
  search.addEventListener("input", () => showMatches(view.search(search.value)));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") showMatches(view.search(search.value, true));
    if (e.key === "Escape") {
      search.value = "";
      showMatches(view.search(""));
    }
  });
  function showMatches(n: number): void {
    matches.textContent = search.value.trim().length < 2 ? "" : n ? `${plural(n, "match")}` : "No matches";
  }

  const restyle = () => view.restyle();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", restyle);
  void document.fonts?.ready.then(restyle);

  // ----- Start -----
  drawHud();
  syncControls();
  const last = storage.loadLastFile();
  let error: string | null = "no file";
  if (last && "graph" in last) error = open(last.graph, last.warnings ?? [], last.name);
  else if (last) error = load(last.text, last.name);
  if (error) {
    if (last) storage.forgetLastFile();
    openLoader();
  }
}

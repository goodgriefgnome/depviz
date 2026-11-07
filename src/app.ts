import { parseDot } from "./importers/dot";
import { ImportError } from "./importers/types";
import { buildHierarchy } from "./model/hierarchy";
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
  let key = "";
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
  );

  // ----- Stage and panel -----
  const canvas = h("div", { id: "cy", "aria-label": "Dependency graph" });
  const hud = h("div", { class: "hud" });
  const stage = h("div", { class: "stage" }, canvas, hud);
  const panel = h("aside", { class: "panel", "aria-live": "polite" });
  const work = h("main", { class: "work" }, stage, panel);

  const loader = new Loader({
    load: (text, name) => load(text, name),
    loadSample: () => {
      load(sampleDot, "acme-shop.dot (sample)");
    },
    close: () => loader.hide(),
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
  function load(text: string, name: string): string | null {
    let result;
    try {
      result = parseDot(text);
    } catch (err) {
      return err instanceof ImportError ? err.message : `Something went wrong reading the file: ${String(err)}`;
    }
    const hierarchy = buildHierarchy(result.graph);
    if (hierarchy.nodes.size === 0) return "The graph has no nodes.";
    warnings = [...result.warnings, ...hierarchy.warnings];
    key = storage.graphKey(hierarchy);
    const saved = storage.loadView(key);
    const vm = new ViewModel(hierarchy, saved);
    if (!saved) vm.setLevel(vm.pickLevel(START_BOXES));
    const label = result.graph.label ?? name;
    title.textContent = label;
    document.title = `${label} · depviz`;
    search.value = "";
    matches.textContent = "";
    view.setModel(vm);
    storage.saveLastFile({ name, text });
    loader.hide();
    syncControls();
    return null;
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
    storage.savePrefs({ layout, autoArrange });
  }

  // ----- Wiring -----
  auto.addEventListener("change", () => {
    autoArrange = auto.checked;
    view.autoArrange = autoArrange;
    savePrefs();
    if (autoArrange) void view.relayout();
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
  const error = last ? load(last.text, last.name) : "no file";
  if (error) {
    if (last) storage.forgetLastFile();
    openLoader();
  }
}

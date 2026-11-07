import { plural, type GraphView, type Neighbour, type Selection } from "../view/graphView";
import type { ViewModel } from "../view/model";
import { h } from "./dom";

export interface PanelActions {
  reveal(id: string): void;
  toggle(id: string): void;
  resetLayout(): void;
}

/** Fills the side panel: a project overview, or details of the selection. */
export function renderPanel(el: HTMLElement, view: GraphView, sel: Selection, warnings: string[], actions: PanelActions): void {
  const vm = view.model;
  if (!vm) {
    el.replaceChildren();
    return;
  }
  if (sel?.type === "node") el.replaceChildren(...nodeDetail(vm, view, sel, actions));
  else if (sel?.type === "edge") el.replaceChildren(...edgeDetail(vm, view, sel.edge));
  else el.replaceChildren(...overview(vm, warnings, actions));
}

function section(title: string, ...body: Array<Node | string>): HTMLElement {
  return h("section", {}, h("h2", {}, title), ...body);
}

function neighbourList(vm: ViewModel, view: GraphView, items: Neighbour[], colour: string, actions: PanelActions): Node {
  if (!items.length) return h("p", { class: "empty" }, "None");
  return h(
    "ul",
    { class: "list" },
    ...items.map((n) =>
      h(
        "li",
        {},
        h(
          "button",
          { type: "button", onclick: () => actions.reveal(n.id) },
          h("span", { class: "sw", style: `border-color: var(--${colour})` }),
          h("span", { class: "name" }, view.path(n.id)),
          n.count > 1 ? h("span", { class: "n" }, `×${n.count}`) : "",
        ),
      ),
    ),
  );
}

function nodeDetail(vm: ViewModel, view: GraphView, sel: Extract<Selection, { type: "node" }>, actions: PanelActions): Node[] {
  const n = vm.node(sel.id);
  const container = n.children.length > 0;
  const collapsed = vm.collapsed.has(sel.id);
  const badges: Node[] = [];
  if (!container && vm.cycles.cycleOf.has(sel.id)) badges.push(h("span", { class: "badge cycle" }, "in an import cycle"));
  if (!container && !sel.importedBy.length) badges.push(h("span", { class: "badge unused" }, "nothing depends on this"));
  const total = (xs: Neighbour[]) => xs.reduce((s, x) => s + x.count, 0);
  const kind = container ? `${collapsed ? "Folder (collapsed)" : "Folder"} · ${plural(vm.leafCount(sel.id), "module")}` : "Module";
  return [
    section(
      "Selected",
      h("p", { class: "path" }, view.path(sel.id)),
      h("div", { class: "kind" }, kind),
      badges.length ? h("div", { class: "badges" }, ...badges) : "",
      container
        ? h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => actions.toggle(sel.id) }, collapsed ? "Expand folder" : "Collapse folder"))
        : "",
    ),
    section(`Depends on · ${total(sel.imports)}`, neighbourList(vm, view, sel.imports, "accent", actions)),
    section(`Used by · ${total(sel.importedBy)}`, neighbourList(vm, view, sel.importedBy, "in", actions)),
    h(
      "p",
      { class: "note" },
      container && !collapsed
        ? "Only dependencies that cross the folder's boundary are listed."
        : "Counts are individual dependencies merged into one arrow.",
    ),
  ];
}

function edgeDetail(vm: ViewModel, view: GraphView, e: { source: string; target: string; count: number; cycle: boolean; pairs: Array<[string, string]> }): Node[] {
  const shown = e.pairs.slice(0, 500);
  return [
    section(
      "Arrow",
      h("p", { class: "path" }, view.path(e.source), h("br"), `→ ${view.path(e.target)}`),
      h("div", { class: "kind" }, `${plural(e.count, "dependency")}${e.cycle ? " · part of a cycle" : ""}`),
    ),
    section(
      "Made up of",
      h(
        "ul",
        { class: "list" },
        ...shown.map(([s, t]) => h("li", { class: "plain" }, s, h("span", { class: "arrow" }, " → "), t)),
      ),
      e.pairs.length > shown.length ? h("p", { class: "note" }, `…and ${e.pairs.length - shown.length} more.`) : "",
    ),
  ];
}

function overview(vm: ViewModel, warnings: string[], actions: PanelActions): Node[] {
  let modules = 0;
  let folders = 0;
  for (const n of vm.h.nodes.values()) n.children.length ? folders++ : modules++;
  const stat = (label: string, value: number, cls = "") => h("div", {}, h("dt", {}, label), h("dd", { class: cls }, value.toLocaleString()));
  const out: Node[] = [
    section(
      "Graph",
      h(
        "dl",
        { class: "stats" },
        stat("Modules", modules),
        stat("Folders", folders),
        stat("Dependencies", vm.h.edges.length),
        stat("Cycles", vm.cycles.count, vm.cycles.count ? "bad" : ""),
      ),
    ),
  ];
  if (warnings.length) {
    out.push(
      section(
        "Notes from loading",
        h("ul", { class: "warnings" }, ...warnings.slice(0, 20).map((w) => h("li", {}, w))),
        warnings.length > 20 ? h("p", { class: "note" }, `…and ${warnings.length - 20} more.`) : "",
      ),
    );
  }
  const row = (swatch: Node, text: string) => h("div", {}, swatch, text);
  out.push(
    section(
      "Legend",
      h(
        "div",
        { class: "legend" },
        row(h("span", { class: "box" }), "Module"),
        row(h("span", { class: "box unused" }), "Nothing depends on it"),
        row(h("span", { class: "box collapsed" }), "Collapsed folder"),
        row(h("span", { class: "sw", style: "border-color: var(--edge)" }), "Depends on (thicker = more)"),
        row(h("span", { class: "sw dashed", style: "border-color: var(--cycle)" }), "Part of a cycle"),
        row(h("span", { class: "sw", style: "border-color: var(--accent)" }), "Selection depends on this"),
        row(h("span", { class: "sw", style: "border-color: var(--in)" }), "This depends on the selection"),
      ),
    ),
    section(
      "Tips",
      h(
        "ul",
        { class: "help" },
        h("li", {}, "Drag modules or whole folders. Positions are remembered."),
        h("li", {}, "Double-click a folder to collapse or expand it."),
        h("li", {}, "Click a module, folder or arrow for details."),
      ),
    ),
    section(
      "Saved layout",
      h("p", { class: "note" }, "Positions and collapsed folders are kept in this browser, per graph."),
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: actions.resetLayout }, "Reset layout")),
    ),
  );
  return out;
}

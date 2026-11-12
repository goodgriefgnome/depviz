import { plural, type GraphView, type Neighbour, type Selection } from "../view/graphView";
import type { ViewModel } from "../view/model";
import { h } from "./dom";

export interface PanelActions {
  /** Selects one node (or the collapsed folder holding it) and centres on it. */
  reveal(id: string): void;
  /** Adds a node to the selection, or removes it if it's already selected. */
  toggleSelected(id: string): void;
  /** Adds a node (or the collapsed folder holding it) to the selection. */
  addToSelection(id: string): void;
  clearSelection(): void;
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
  if (sel?.type === "nodes" && sel.ids.length === 1) el.replaceChildren(...nodeDetail(vm, view, sel, sel.ids[0]!, actions));
  else if (sel?.type === "nodes") el.replaceChildren(...multiDetail(vm, view, sel, actions));
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
          {
            type: "button",
            title: "Click to select · Shift-click to add to the selection",
            onclick: (e: Event) => ((e as MouseEvent).shiftKey || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey ? actions.addToSelection(n.id) : actions.reveal(n.id)),
          },
          h("span", { class: "sw", style: `border-color: var(--${colour})` }),
          h("span", { class: "name" }, view.path(n.id)),
          n.count > 1 ? h("span", { class: "n" }, `×${n.count}`) : "",
        ),
      ),
    ),
  );
}

type NodesSelection = Extract<Selection, { type: "nodes" }>;
const total = (xs: Neighbour[]) => xs.reduce((s, x) => s + x.count, 0);

function nodeDetail(vm: ViewModel, view: GraphView, sel: NodesSelection, id: string, actions: PanelActions): Node[] {
  const n = vm.node(id);
  const container = n.children.length > 0;
  const collapsed = vm.collapsed.has(id);
  const badges: Node[] = [];
  if (!container && vm.cycles.cycleOf.has(id)) badges.push(h("span", { class: "badge cycle" }, "in an import cycle"));
  if (!container && !sel.importedBy.length) badges.push(h("span", { class: "badge unused" }, "nothing depends on this"));
  const kind = container ? `${collapsed ? "Folder (collapsed)" : "Folder"} · ${plural(vm.leafCount(id), "module")}` : "Module";
  return [
    section(
      "Selected",
      h("p", { class: "path" }, view.path(id)),
      h("div", { class: "kind" }, kind),
      badges.length ? h("div", { class: "badges" }, ...badges) : "",
      container
        ? h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => actions.toggle(id) }, collapsed ? "Expand folder" : "Collapse folder"))
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

function multiDetail(vm: ViewModel, view: GraphView, sel: NodesSelection, actions: PanelActions): Node[] {
  const modules = sel.ids.reduce((sum, id) => sum + (vm.isContainer(id) ? vm.leafCount(id) : 1), 0);
  return [
    section(
      `Selected · ${sel.ids.length}`,
      h("div", { class: "kind" }, `${plural(modules, "module")} in all`),
      h(
        "ul",
        { class: "list" },
        ...sel.ids.map((id) =>
          h(
            "li",
            { class: "picked" },
            h("button", { type: "button", title: "Select only this", onclick: () => actions.reveal(id) }, h("span", { class: "name" }, view.path(id))),
            h("button", { type: "button", class: "remove", title: "Remove from selection", "aria-label": `Remove ${view.path(id)} from selection`, onclick: () => actions.toggleSelected(id) }, "×"),
          ),
        ),
      ),
      h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: () => actions.clearSelection() }, "Clear selection")),
    ),
    section(`Depends on · ${total(sel.imports)}`, neighbourList(vm, view, sel.imports, "accent", actions)),
    section(`Used by · ${total(sel.importedBy)}`, neighbourList(vm, view, sel.importedBy, "in", actions)),
    h(
      "p",
      { class: "note" },
      `Only dependencies to and from outside the selection are listed. ${sel.between ? `${plural(sel.between, "dependency")} between selected items ${sel.between === 1 ? "is" : "are"} drawn but not listed.` : "There are none between selected items."}`,
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
        h("li", {}, "Shift-click, or shift-drag a box, to select several. Esc clears."),
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

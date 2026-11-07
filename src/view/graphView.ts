import cytoscape from "cytoscape";
import { getElk } from "./elk";
import { computeLayout, type LayoutName } from "./layout";
import type { ViewModel, VisibleEdge } from "./model";
import { boxSize, graphStyle } from "./style";

export interface Neighbour {
  id: string;
  /** Number of input edges behind the arrow(s). */
  count: number;
}

export type Selection =
  | { type: "node"; id: string; imports: Neighbour[]; importedBy: Neighbour[] }
  | { type: "edge"; edge: VisibleEdge }
  | null;

export interface GraphViewEvents {
  /** Selection changed (also after a re-render that keeps it). */
  onSelect(sel: Selection): void;
  /** Positions or collapsed state changed and should be saved. */
  onChange(): void;
  /** Pointer moved over a node or edge; null when it leaves. */
  onHover(text: string | null): void;
  /** Layout started or finished. */
  onBusy(busy: boolean): void;
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class GraphView {
  readonly cy: cytoscape.Core;
  private vm: ViewModel | undefined;
  private selected: { type: "node"; id: string } | { type: "edge"; source: string; target: string } | null = null;
  private searchTerm = "";
  private layoutSeq = 0;
  layoutName: LayoutName = "layered";
  autoArrange = true;

  constructor(
    container: HTMLElement,
    private readonly events: GraphViewEvents,
  ) {
    this.cy = cytoscape({
      container,
      style: graphStyle(),
      elements: [],
      boxSelectionEnabled: false,
      minZoom: 0.05,
      maxZoom: 3,
    });
    const cy = this.cy;
    cy.on("tap", "node", (e) => this.select({ type: "node", id: e.target.id() }));
    cy.on("tap", "edge", (e) => this.select({ type: "edge", source: e.target.data("source"), target: e.target.data("target") }));
    cy.on("tap", (e) => {
      if (e.target === cy) this.select(null);
    });
    cy.on("dbltap", "node.open, node.collapsed", (e) => this.toggle(e.target.id()));
    cy.on("dragfree", "node", () => {
      this.savePositions();
      this.events.onChange();
    });
    cy.on("mouseover", "node", (e) => this.events.onHover(this.describeNode(e.target.id())));
    cy.on("mouseover", "edge", (e) => {
      const d = e.target.data() as VisibleEdge;
      this.events.onHover(`${this.path(d.source)} → ${this.path(d.target)} · ${plural(d.count, "import")}`);
    });
    cy.on("mouseout", "node, edge", () => this.events.onHover(null));
  }

  get model(): ViewModel | undefined {
    return this.vm;
  }

  setModel(vm: ViewModel): void {
    this.vm = vm;
    this.selected = null;
    this.searchTerm = "";
    this.render({ fit: true });
  }

  /** Redraws from the model. Lays out if any box has no position yet. */
  render(opts: { fit?: boolean } = {}): void {
    const vm = this.vm;
    if (!vm) return;
    const els: cytoscape.ElementDefinition[] = [];
    for (const n of vm.visibleNodes()) {
      const label = n.kind === "collapsed" ? `${n.label}\n${plural(n.leafCount, "module")}` : n.label;
      const classes: string[] = [n.kind];
      if (n.kind === "open" && n.depth % 2 === 1) classes.push("odd");
      if (n.unused) classes.push("unused");
      const data: Record<string, unknown> = { id: n.id, label };
      if (n.parent !== undefined) data.parent = n.parent;
      if (n.kind !== "open") Object.assign(data, boxSize(label));
      const el: cytoscape.ElementDefinition = { group: "nodes", data, classes: classes.join(" ") };
      const p = vm.pos.get(n.id);
      if (n.kind !== "open" && p) el.position = { ...p };
      els.push(el);
    }
    for (const e of vm.visibleEdges()) {
      els.push({ group: "edges", data: { ...e, w: 1.2 + Math.log2(e.count) * 1.3 }, classes: e.cycle ? "cycle" : "" });
    }
    this.cy.batch(() => {
      this.cy.elements().remove();
      this.cy.add(els);
    });
    if (vm.unplaced().length) void this.relayout({ animate: !opts.fit });
    else if (opts.fit) this.fit(false);
    this.applySelection();
    this.applySearch();
  }

  /** Runs the current layout over everything shown. */
  async relayout(opts: { animate?: boolean } = {}): Promise<void> {
    const vm = this.vm;
    if (!vm) return;
    const seq = ++this.layoutSeq;
    this.events.onBusy(true);
    try {
      const nodes = this.cy.nodes().map((n) => {
        const parent = n.parent().first();
        const base = parent.nonempty() ? { id: n.id(), parent: parent.id() } : { id: n.id() };
        if (n.isParent()) return base;
        const d = n.layoutDimensions({ nodeDimensionsIncludeLabels: true });
        return { ...base, width: d.w, height: d.h };
      });
      const edges = this.cy.edges().map((e) => ({ id: e.id(), source: e.data("source") as string, target: e.data("target") as string }));
      const pos = await computeLayout(getElk(), nodes, edges, this.layoutName);
      if (seq !== this.layoutSeq || vm !== this.vm) return;
      const animate = (opts.animate ?? true) && !reduceMotion();
      await new Promise<void>((resolve) => {
        const l = this.cy.nodes(":childless").layout({
          name: "preset",
          positions: Object.fromEntries(pos),
          animate,
          animationDuration: 450,
          fit: false,
        });
        l.one("layoutstop", () => resolve());
        l.run();
      });
      if (seq !== this.layoutSeq) return;
      this.fit(animate);
      this.savePositions();
      this.events.onChange();
    } catch (err) {
      console.error("Layout failed", err);
    } finally {
      if (seq === this.layoutSeq) this.events.onBusy(false);
    }
  }

  private savePositions(): void {
    const vm = this.vm;
    if (!vm) return;
    this.cy.nodes(":childless").forEach((n) => {
      vm.pos.set(n.id(), { ...n.position() });
    });
  }

  toggle(id: string): void {
    const vm = this.vm;
    if (!vm) return;
    this.savePositions();
    vm.toggle(id);
    this.afterStructureChange();
  }

  setLevel(level: number | null): void {
    const vm = this.vm;
    if (!vm) return;
    this.savePositions();
    vm.setLevel(level);
    this.afterStructureChange();
  }

  private afterStructureChange(): void {
    this.render();
    if (this.autoArrange) void this.relayout();
    this.events.onChange();
  }

  /** Fits everything, folders and labels included, without zooming small graphs past 150%. */
  fit(animate = true): void {
    const cy = this.cy;
    if (cy.elements().empty()) return;
    const bb = cy.elements().boundingBox();
    const pad = 40;
    const zoom = Math.max(cy.minZoom(), Math.min(1.5, (cy.width() - 2 * pad) / bb.w, (cy.height() - 2 * pad) / bb.h));
    const pan = { x: cy.width() / 2 - zoom * (bb.x1 + bb.w / 2), y: cy.height() / 2 - zoom * (bb.y1 + bb.h / 2) };
    if (animate && !reduceMotion()) cy.animate({ zoom, pan }, { duration: 300 });
    else cy.viewport({ zoom, pan });
  }

  /** Selects and centres on a node, expanding nothing: a hidden node selects its collapsed container. */
  reveal(id: string): void {
    const vm = this.vm;
    if (!vm) return;
    const shown = vm.rep(id);
    this.select({ type: "node", id: shown });
    const el = this.cy.getElementById(shown);
    if (el.nonempty()) this.cy.animate({ center: { eles: el } }, { duration: reduceMotion() ? 0 : 300 });
  }

  select(sel: { type: "node"; id: string } | { type: "edge"; source: string; target: string } | null): void {
    this.selected = sel;
    this.applySelection();
  }

  private applySelection(): void {
    const cy = this.cy;
    cy.elements().removeClass("dim out in outn inn focus");
    const sel = this.selected;
    if (sel?.type === "node") {
      const n = cy.getElementById(sel.id);
      if (n.empty()) return this.clearSelection();
      const inside = n.isParent() ? n.union(n.descendants()) : n;
      const out = cy.edges().filter((e) => inside.has(e.source()) && !inside.has(e.target()));
      const inc = cy.edges().filter((e) => inside.has(e.target()) && !inside.has(e.source()));
      cy.elements().addClass("dim");
      inside.removeClass("dim");
      n.addClass("focus");
      out.removeClass("dim").addClass("out");
      out.targets().removeClass("dim").addClass("outn");
      inc.removeClass("dim").addClass("in");
      inc.sources().removeClass("dim").addClass("inn");
      inside.union(out.targets()).union(inc.sources()).ancestors().removeClass("dim");
      this.events.onSelect({ type: "node", id: sel.id, imports: neighbours(out, "target"), importedBy: neighbours(inc, "source") });
    } else if (sel?.type === "edge") {
      const e = cy.edges().filter((x) => x.data("source") === sel.source && x.data("target") === sel.target);
      if (e.empty()) return this.clearSelection();
      cy.elements().addClass("dim");
      e.removeClass("dim").addClass("out");
      e.connectedNodes().removeClass("dim").ancestors().removeClass("dim");
      e.source().addClass("focus");
      e.target().addClass("outn");
      this.events.onSelect({ type: "edge", edge: e.first().data() as VisibleEdge });
    } else {
      this.events.onSelect(null);
    }
  }

  private clearSelection(): void {
    this.selected = null;
    this.events.onSelect(null);
  }

  /** Highlights boxes whose path contains `term`. Returns the number of matching modules. */
  search(term: string, zoom = false): number {
    this.searchTerm = term.trim().toLowerCase();
    const els = this.applySearch();
    if (zoom && els.nonempty()) this.cy.animate({ fit: { eles: els, padding: 120 } }, { duration: reduceMotion() ? 0 : 350 });
    return this.matchCount;
  }

  private matchCount = 0;

  private applySearch(): cytoscape.CollectionReturnValue {
    const cy = this.cy;
    cy.nodes().removeClass("match");
    const vm = this.vm;
    let els = cy.collection();
    this.matchCount = 0;
    if (!vm || this.searchTerm.length < 2) return els;
    const reps = new Set<string>();
    for (const n of vm.h.nodes.values()) {
      if (n.children.length || !n.id.toLowerCase().includes(this.searchTerm)) continue;
      this.matchCount++;
      reps.add(vm.rep(n.id));
    }
    for (const r of reps) els = els.union(cy.getElementById(r));
    els.addClass("match");
    return els;
  }

  restyle(): void {
    this.cy.style(graphStyle());
  }

  /** Full path of a node for display, e.g. `src/lib/` or `src/lib/api.js`. */
  path(id: string): string {
    const vm = this.vm;
    const n = vm?.h.nodes.get(id);
    if (!vm || !n) return id;
    if (n.kind === "leaf") return id;
    const parts: string[] = [];
    for (let c: string | null = id; c !== null; c = vm.node(c).parent) parts.unshift(vm.node(c).label);
    return parts.join(parts.every((p) => p.endsWith("/")) ? "" : " › ");
  }

  private describeNode(id: string): string {
    const vm = this.vm;
    if (!vm) return id;
    return vm.isContainer(id) ? `${this.path(id)} · ${plural(vm.leafCount(id), "module")}` : this.path(id);
  }

  destroy(): void {
    this.cy.destroy();
  }
}

function neighbours(edges: cytoscape.EdgeCollection, end: "source" | "target"): Neighbour[] {
  const counts = new Map<string, number>();
  edges.forEach((e) => {
    const id = e.data(end) as string;
    counts.set(id, (counts.get(id) ?? 0) + (e.data("count") as number));
  });
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

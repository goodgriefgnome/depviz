import { findCycles, type CycleInfo } from "../model/analysis";
import { descendants, type Hierarchy, type TreeNode } from "../model/hierarchy";

export interface Pos {
  x: number;
  y: number;
}

/** What is saved between visits for one graph. */
export interface SavedView {
  collapsed: string[];
  pos: Record<string, Pos>;
  /** Where each collapsed container's box was placed when it collapsed. */
  origin: Record<string, Pos>;
}

/** A box or container to draw. */
export interface VisibleNode {
  id: string;
  label: string;
  /** Drawn parent container, if any. */
  parent?: string;
  /** `leaf`: a module. `open`: an expanded container. `collapsed`: a container drawn as one box. */
  kind: "leaf" | "open" | "collapsed";
  /** Tree depth, for alternating container shades. */
  depth: number;
  /** Modules inside, for collapsed containers. */
  leafCount: number;
  inCycle: boolean;
  /** Nothing depends on it (leaves only). */
  unused: boolean;
}

/** One drawn arrow, standing for one or more input edges. */
export interface VisibleEdge {
  id: string;
  source: string;
  target: string;
  count: number;
  cycle: boolean;
  /** The input edges merged into this arrow. */
  pairs: Array<[string, string]>;
}

/**
 * Display state over a hierarchy: which containers are collapsed, where boxes
 * are, and what that means for the nodes and arrows to draw.
 */
export class ViewModel {
  readonly cycles: CycleInfo;
  readonly collapsed: Set<string>;
  pos: Map<string, Pos>;
  origin: Map<string, Pos>;
  /** Depth of the deepest container. -1 if there are none. */
  readonly maxContainerDepth: number;
  private readonly leafCounts = new Map<string, number>();
  private readonly incoming = new Map<string, number>();

  constructor(
    readonly h: Hierarchy,
    saved?: Partial<SavedView>,
  ) {
    this.cycles = findCycles(h.nodes.keys(), h.edges);
    for (const e of h.edges) this.incoming.set(e.target, (this.incoming.get(e.target) ?? 0) + 1);
    this.collapsed = new Set((saved?.collapsed ?? []).filter((id) => this.isContainer(id)));
    this.pos = new Map(Object.entries(saved?.pos ?? {}).filter(([id]) => h.nodes.has(id)));
    this.origin = new Map(Object.entries(saved?.origin ?? {}).filter(([id]) => h.nodes.has(id)));
    let max = -1;
    for (const n of h.nodes.values()) if (n.children.length) max = Math.max(max, n.depth);
    this.maxContainerDepth = max;
  }

  node(id: string): TreeNode {
    const n = this.h.nodes.get(id);
    if (!n) throw new Error(`Unknown node ${id}`);
    return n;
  }

  isContainer(id: string): boolean {
    return (this.h.nodes.get(id)?.children.length ?? 0) > 0;
  }

  /** The visible node that stands for `id`: its outermost collapsed ancestor, or itself. */
  rep(id: string): string {
    let r = id;
    for (let p = this.node(id).parent; p !== null; p = this.node(p).parent) if (this.collapsed.has(p)) r = p;
    return r;
  }

  /** Drawn as a box with a position of its own (not a container around others). */
  isBox(id: string): boolean {
    return !this.isContainer(id) || this.collapsed.has(id);
  }

  leafCount(id: string): number {
    let c = this.leafCounts.get(id);
    if (c === undefined) {
      const n = this.node(id);
      c = n.children.length ? n.children.reduce((s, k) => s + this.leafCount(k), 0) : 1;
      this.leafCounts.set(id, c);
    }
    return c;
  }

  visibleNodes(): VisibleNode[] {
    const out: VisibleNode[] = [];
    const visit = (id: string, parent: string | undefined) => {
      const n = this.node(id);
      const container = n.children.length > 0;
      const collapsed = container && this.collapsed.has(id);
      const v: VisibleNode = {
        id,
        label: n.label,
        kind: !container ? "leaf" : collapsed ? "collapsed" : "open",
        depth: n.depth,
        leafCount: this.leafCount(id),
        inCycle: !container && this.cycles.cycleOf.has(id),
        unused: !container && !this.incoming.get(id),
      };
      if (parent !== undefined) v.parent = parent;
      out.push(v);
      if (container && !collapsed) for (const c of n.children) visit(c, id);
    };
    for (const r of this.h.roots) visit(r, undefined);
    return out;
  }

  visibleEdges(): VisibleEdge[] {
    const agg = new Map<string, VisibleEdge>();
    for (const e of this.h.edges) {
      const source = this.rep(e.source);
      const target = this.rep(e.target);
      if (source === target) continue;
      const key = JSON.stringify([source, target]);
      let v = agg.get(key);
      if (!v) agg.set(key, (v = { id: `e${agg.size}`, source, target, count: 0, cycle: false, pairs: [] }));
      v.count++;
      v.cycle ||= this.cycles.isCycleEdge(e);
      v.pairs.push([e.source, e.target]);
    }
    return [...agg.values()];
  }

  /** Average position of the boxes inside a container. */
  private centroid(id: string): Pos | undefined {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const d of descendants(this.h, id)) {
      const p = this.pos.get(d);
      if (p && this.isBox(d)) {
        x += p.x;
        y += p.y;
        n++;
      }
    }
    return n ? { x: x / n, y: y / n } : undefined;
  }

  /** Collapse a container into one box at the centre of what it held. */
  collapse(id: string): void {
    if (!this.isContainer(id) || this.collapsed.has(id)) return;
    const c = this.centroid(id);
    if (c) {
      this.pos.set(id, c);
      this.origin.set(id, { ...c });
    }
    this.collapsed.add(id);
  }

  /**
   * Expand a container. Its contents return to where they were, shifted by
   * however far the collapsed box was dragged. Contents that never had a
   * position are spread around the box.
   */
  expand(id: string): void {
    if (!this.collapsed.delete(id)) return;
    const cur = this.pos.get(id);
    if (!cur) return;
    const o = this.origin.get(id) ?? cur;
    const dx = cur.x - o.x;
    const dy = cur.y - o.y;
    let k = 0;
    for (const d of descendants(this.h, id)) {
      const p = this.pos.get(d);
      if (p) this.pos.set(d, { x: p.x + dx, y: p.y + dy });
      else if (this.isBox(d)) {
        const a = k * 2.4;
        const r = 30 + 9 * ++k;
        this.pos.set(d, { x: cur.x + r * Math.cos(a), y: cur.y + r * Math.sin(a) });
      }
      const od = this.origin.get(d);
      if (od) this.origin.set(d, { x: od.x + dx, y: od.y + dy });
    }
  }

  toggle(id: string): void {
    if (this.collapsed.has(id)) this.expand(id);
    else this.collapse(id);
  }

  /**
   * Show containers down to `level`: containers shallower than it are
   * expanded, those at it are collapsed. `null` expands everything.
   */
  setLevel(level: number | null): void {
    const containers = [...this.h.nodes.values()].filter((n) => n.children.length).sort((a, b) => a.depth - b.depth);
    for (const n of containers) this.expand(n.id);
    if (level !== null) for (const n of containers) if (n.depth === level) this.collapse(n.id);
  }

  /** The level that matches the current collapsed state, `null` for all expanded, or `undefined` for a mix. */
  currentLevel(): number | null | undefined {
    if (this.collapsed.size === 0) return null;
    const visibleCollapsed = [...this.collapsed].filter((id) => this.rep(id) === id);
    const depths = new Set(visibleCollapsed.map((id) => this.node(id).depth));
    if (depths.size !== 1) return undefined;
    const level = [...depths][0]!;
    for (const n of this.h.nodes.values()) {
      if (!n.children.length) continue;
      if (n.depth < level && this.collapsed.has(n.id)) return undefined;
      if (n.depth === level && !this.collapsed.has(n.id)) return undefined;
    }
    return level;
  }

  /** Number of boxes drawn at a level, to pick a sensible starting view. */
  boxCountAt(level: number | null): number {
    let count = 0;
    for (const n of this.h.nodes.values()) {
      if (level === null) count += n.children.length ? 0 : 1;
      else if (n.depth === level ? true : n.depth < level && !n.children.length) count++;
    }
    return count;
  }

  /** The deepest level that draws at most `maxBoxes` boxes. */
  pickLevel(maxBoxes: number): number | null {
    if (this.boxCountAt(null) <= maxBoxes || this.maxContainerDepth < 0) return null;
    let best = 0;
    for (let l = 0; l <= this.maxContainerDepth; l++) if (this.boxCountAt(l) <= maxBoxes) best = l;
    return best;
  }

  /** Boxes that are drawn but have no position yet. */
  unplaced(): string[] {
    return this.visibleNodes()
      .filter((n) => n.kind !== "open" && !this.pos.has(n.id))
      .map((n) => n.id);
  }

  save(): SavedView {
    return {
      collapsed: [...this.collapsed],
      pos: Object.fromEntries(this.pos),
      origin: Object.fromEntries(this.origin),
    };
  }
}

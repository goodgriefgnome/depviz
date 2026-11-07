import type { DepGraph, GraphEdge, GraphNode } from "./types";

/**
 * A node in the display tree.
 * - `leaf`: a node from the input graph with no children (a module).
 * - `group`: a node from the input graph that other nodes name as `parent`.
 * - `folder`: a group synthesized from the `/`-separated path of node ids.
 */
export interface TreeNode {
  id: string;
  label: string;
  kind: "leaf" | "group" | "folder";
  parent: string | null;
  children: string[];
  /** 0 for top-level nodes. */
  depth: number;
  /** The input node, for `leaf` and `group`. */
  source?: GraphNode;
}

export interface Hierarchy {
  nodes: Map<string, TreeNode>;
  /** Top-level node ids. Siblings are ordered folders/groups first, then by label. */
  roots: string[];
  /** Input edges whose endpoints both exist in `nodes`. */
  edges: GraphEdge[];
  /** Problems found and repaired while building, for display to the user. */
  warnings: string[];
}

export interface HierarchyOptions {
  /** Infer folders from `/` in ids of nodes without an explicit parent. Default true. */
  inferFromPaths?: boolean;
  /**
   * Merge chains of folders that each hold only one folder, e.g. `home/me/proj/`
   * becomes a single folder labelled `home/me/proj/`. Default true.
   */
  compactFolders?: boolean;
}

/** Turns an id into path segments: drops `./`, leading/trailing `/` and empty parts. */
export function pathSegments(id: string): string[] {
  return id
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== ".");
}

export function buildHierarchy(graph: DepGraph, options: HierarchyOptions = {}): Hierarchy {
  const { inferFromPaths = true, compactFolders = true } = options;
  const warnings: string[] = [];
  const nodes = new Map<string, TreeNode>();
  const parentOf = new Map<string, string | null>();

  // 1. Input nodes. Later duplicates merge into the first occurrence.
  const inputs = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    const prev = inputs.get(n.id);
    if (prev) {
      inputs.set(n.id, { ...prev, ...n, metadata: { ...prev.metadata, ...n.metadata } });
      warnings.push(`Node "${n.id}" is defined more than once; the definitions were merged.`);
    } else {
      inputs.set(n.id, n);
    }
  }
  // Edge endpoints that were never declared become plain nodes (as in DOT).
  for (const e of graph.edges) {
    for (const id of [e.source, e.target]) if (!inputs.has(id)) inputs.set(id, { id });
  }
  // Parents that were never declared become plain group nodes.
  for (const n of [...inputs.values()]) {
    if (n.parent !== undefined && !inputs.has(n.parent)) {
      inputs.set(n.parent, { id: n.parent });
      warnings.push(`Parent "${n.parent}" of "${n.id}" is not defined; created it.`);
    }
  }
  for (const n of inputs.values()) {
    nodes.set(n.id, {
      id: n.id,
      label: n.label ?? lastSegment(n.id),
      kind: "leaf",
      parent: null,
      children: [],
      depth: 0,
      source: n,
    });
    parentOf.set(n.id, n.parent === undefined || n.parent === n.id ? null : n.parent);
  }

  // 2. Break cycles in explicit parent links.
  for (const id of nodes.keys()) {
    const seen = new Set<string>([id]);
    let p = parentOf.get(id) ?? null;
    while (p !== null) {
      if (seen.has(p)) {
        warnings.push(`Nesting loop involving "${id}"; moved it to the top level.`);
        parentOf.set(id, null);
        break;
      }
      seen.add(p);
      p = parentOf.get(p) ?? null;
    }
  }

  // 3. Infer folders from paths, for nodes with no explicit parent.
  if (inferFromPaths) {
    const folderIds = new Map<string, string>(); // folder path -> tree id
    const ensureFolder = (segments: string[]): string => {
      const path = segments.join("/");
      const existing = folderIds.get(path);
      if (existing) return existing;
      let id = path + "/";
      while (nodes.has(id)) id += "#";
      folderIds.set(path, id);
      nodes.set(id, { id, label: segments[segments.length - 1] + "/", kind: "folder", parent: null, children: [], depth: 0 });
      parentOf.set(id, segments.length > 1 ? ensureFolder(segments.slice(0, -1)) : null);
      return id;
    };
    for (const n of inputs.values()) {
      if (parentOf.get(n.id) !== null) continue;
      const segs = pathSegments(n.id);
      if (segs.length > 1) parentOf.set(n.id, ensureFolder(segs.slice(0, -1)));
    }
  }

  // 4. Link children, mark groups.
  const roots: string[] = [];
  for (const [id, node] of nodes) {
    const p = parentOf.get(id) ?? null;
    node.parent = p;
    if (p === null) roots.push(id);
    else nodes.get(p)!.children.push(id);
  }
  for (const node of nodes.values()) if (node.kind === "leaf" && node.children.length) node.kind = "group";

  // 5. Compact single-folder chains.
  if (compactFolders) {
    const compact = (id: string): string => {
      let node = nodes.get(id)!;
      while (node.kind === "folder" && node.children.length === 1) {
        const child = nodes.get(node.children[0]!)!;
        if (child.kind !== "folder") break;
        child.label = node.label + child.label;
        child.parent = node.parent;
        nodes.delete(node.id);
        node = child;
      }
      node.children = node.children.map(compact);
      return node.id;
    };
    roots.splice(0, roots.length, ...roots.map(compact));
  }

  // 6. Order like a file explorer: containers first, then by name.
  const byKindThenName = (x: string, y: string) => {
    const a = nodes.get(x)!, b = nodes.get(y)!;
    const ca = a.kind === "leaf" ? 1 : 0, cb = b.kind === "leaf" ? 1 : 0;
    return ca - cb || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
  };
  roots.sort(byKindThenName);
  for (const node of nodes.values()) node.children.sort(byKindThenName);

  // 7. Depths.
  const setDepth = (id: string, depth: number) => {
    const node = nodes.get(id)!;
    node.depth = depth;
    for (const c of node.children) setDepth(c, depth + 1);
  };
  for (const r of roots) setDepth(r, 0);

  return { nodes, roots, edges: graph.edges.filter((e) => nodes.has(e.source) && nodes.has(e.target)), warnings };
}

function lastSegment(id: string): string {
  const segs = pathSegments(id);
  return segs[segs.length - 1] ?? id;
}

/** Ids of all nodes below `id`, depth-first. */
export function descendants(h: Hierarchy, id: string): string[] {
  const out: string[] = [];
  const walk = (n: string) => {
    for (const c of h.nodes.get(n)?.children ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

/** Ids of the ancestors of `id`, nearest first. */
export function ancestors(h: Hierarchy, id: string): string[] {
  const out: string[] = [];
  let p = h.nodes.get(id)?.parent ?? null;
  while (p !== null) {
    out.push(p);
    p = h.nodes.get(p)?.parent ?? null;
  }
  return out;
}

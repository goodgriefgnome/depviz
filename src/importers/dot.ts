import {
  parse,
  type AttributeASTNode,
  type ClusterStatementASTNode,
  type EdgeTargetASTNode,
  type GraphASTNode,
  type LiteralASTNode,
} from "@ts-graphviz/ast";
import type { DepGraph, GraphEdge, GraphNode } from "../model/types";
import { ImportError, type ImportResult } from "./types";

/**
 * Reads a Graphviz DOT file into a DepGraph.
 *
 * - Every node and edge becomes a graph node and edge. Attributes are kept
 *   in `metadata.attributes`.
 * - `subgraph cluster_*` blocks become groups and nest. A node mentioned inside
 *   a cluster gets it as its `parent`; a repeated cluster name reopens the same
 *   cluster. Other subgraphs (e.g. `{rank=same; …}`) don't affect grouping.
 * - Edge chains (`a -> b -> c`) and groups (`a -> {b c}`) are expanded into
 *   single edges. Ports (`a:p -> b`) are dropped. Repeated edges are merged.
 * - In an undirected `graph`, each edge points left to right as written.
 */
export function parseDot(text: string): ImportResult {
  let ast;
  try {
    ast = parse(text, {
      // The file is the user's own and parsed in their browser, so allow big graphs.
      maxASTNodes: 5_000_000,
      maxInputSize: 200 * 1024 * 1024,
      maxEdgeChainDepth: 100_000,
    });
  } catch (err) {
    throw new ImportError(describeSyntaxError(err));
  }

  const root = ast.children.find((c): c is GraphASTNode => c.type === "Graph");
  if (!root) throw new ImportError("The file contains no graph. A DOT file starts with `digraph` or `graph`.");

  const warnings: string[] = [];
  if (!root.directed) warnings.push("This is an undirected graph; each edge was read as pointing from left to right.");

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const clusterIds = new Set<string>();

  const clusterParent = new Map<string, string | undefined>();
  const isInside = (inner: string, outer: string) => {
    for (let c: string | undefined = inner; c !== undefined; c = clusterParent.get(c)) if (c === outer) return true;
    return false;
  };
  /**
   * Records that `id` appears inside `cluster`. As in Graphviz, a node belongs
   * to every cluster that mentions it; we keep the first, or a cluster nested
   * inside it.
   */
  const mention = (id: string, cluster: string | undefined) => {
    const node = nodes.get(id);
    if (!node) {
      nodes.set(id, cluster === undefined ? { id } : { id, parent: cluster });
    } else if (cluster !== undefined && (node.parent === undefined || isInside(cluster, node.parent))) {
      node.parent = cluster;
    } else if (cluster !== undefined && !isInside(node.parent!, cluster)) {
      multiCluster.add(id);
    }
  };
  const multiCluster = new Set<string>();

  /** Ids named by one end of an edge. */
  const targetIds = (t: EdgeTargetASTNode): string[] =>
    t.type === "NodeRef" ? [t.id.value] : t.children.map((r) => r.id.value);

  const walk = (statements: readonly ClusterStatementASTNode[], cluster: string | undefined) => {
    for (const s of statements) {
      switch (s.type) {
        case "Node": {
          mention(s.id.value, cluster);
          const node = nodes.get(s.id.value)!;
          const attrs = attributes(s.children);
          if (Object.keys(attrs).length) {
            node.metadata = { attributes: { ...(node.metadata?.attributes as object), ...attrs } };
          }
          const label = labelOf(s.children, s.id.value);
          if (label !== undefined) node.label = label;
          break;
        }
        case "Edge": {
          const ends = s.targets.map(targetIds);
          ends.flat().forEach((id) => mention(id, cluster));
          const attrs = attributes(s.children);
          for (let i = 0; i + 1 < ends.length; i++) {
            for (const source of ends[i]!) {
              for (const target of ends[i + 1]!) {
                const key = JSON.stringify([source, target]);
                if (edges.has(key)) continue;
                const edge: GraphEdge = { source, target };
                if (Object.keys(attrs).length) edge.metadata = { attributes: attrs };
                edges.set(key, edge);
              }
            }
          }
          break;
        }
        case "Subgraph": {
          const name = s.id?.value;
          if (name !== undefined && name.startsWith("cluster")) {
            // A repeated name reopens the same cluster (dependency-cruiser relies on this).
            let group = groupByName.get(name);
            if (!group) {
              group = { id: name, label: clusterName(name) };
              if (cluster !== undefined) group.parent = cluster;
              groupByName.set(name, group);
              clusterIds.add(name);
              clusterParent.set(name, cluster);
              groups.push(group);
            }
            const label = labelOf(s.children, name);
            if (label !== undefined) group.label = label;
            walk(s.children, group.id);
          } else {
            walk(s.children, cluster);
          }
          break;
        }
        default:
          break; // attribute statements and comments
      }
    }
  };
  const groups: GraphNode[] = [];
  const groupByName = new Map<string, GraphNode>();
  walk(root.children, undefined);

  if (multiCluster.size) {
    const list = [...multiCluster].slice(0, 3).map((id) => `"${id}"`).join(", ");
    warnings.push(`${multiCluster.size} node(s) appear in more than one cluster (${list}${multiCluster.size > 3 ? ", …" : ""}); each was placed in the first.`);
  }

  // A cluster id can clash with a node id; the node keeps it and the cluster is renamed.
  for (const g of groups) {
    if (!nodes.has(g.id)) continue;
    const old = g.id;
    let id = `${old} (cluster)`;
    while (nodes.has(id) || clusterIds.has(id)) id += "#";
    clusterIds.add(id);
    g.id = id;
    for (const n of [...nodes.values(), ...groups]) if (n.parent === old) n.parent = id;
    warnings.push(`Cluster "${old}" has the same name as a node; it was renamed to "${id}".`);
  }

  const graph: DepGraph = { nodes: [...groups, ...nodes.values()], edges: [...edges.values()] };
  const title = graphLabel(root);
  if (title !== undefined) graph.label = title;
  return { graph, warnings };
}

function attributes(children: readonly { type: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of children) {
    if (c.type === "Attribute") {
      const a = c as AttributeASTNode;
      out[a.key.value] = a.value.value;
    }
  }
  return out;
}

/** The node or cluster `label` attribute as plain text, or undefined if it adds nothing. */
function labelOf(children: readonly { type: string }[], id: string): string | undefined {
  const attr = children.find((c): c is AttributeASTNode => c.type === "Attribute" && (c as AttributeASTNode).key.value === "label");
  if (!attr) return undefined;
  const text = literalText(attr.value, id);
  return text === "" || text === id ? undefined : text;
}

/** Plain text of a DOT string: HTML tags removed, escape sequences resolved. */
export function literalText(lit: LiteralASTNode, id = ""): string {
  if (lit.quoted === "html") {
    return decodeEntities(lit.value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
  }
  return lit.value
    .replace(/\\[nlr]/g, " ") // line breaks
    .replace(/\\N/g, id) // the node's own name
    .replace(/\\G/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}

/** `cluster_src/lib` -> `src/lib`; `cluster` -> `cluster`. */
function clusterName(name: string): string {
  const rest = name.replace(/^cluster[_\s-]?/, "");
  return rest === "" ? name : rest;
}

function graphLabel(g: GraphASTNode): string | undefined {
  for (const c of g.children) {
    if (c.type === "Attribute" && c.key.value === "label") {
      const t = literalText(c.value);
      if (t) return t;
    }
  }
  return g.id?.value || undefined;
}

function describeSyntaxError(err: unknown): string {
  const cause = (err as { cause?: { location?: { start?: { line: number; column: number } }; found?: string | null } })?.cause;
  const at = cause?.location?.start;
  if (at) {
    const found = cause?.found == null ? "the end of the file" : `"${cause.found}"`;
    return `This isn't valid DOT: line ${at.line}, column ${at.column} has unexpected ${found}.`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `This isn't valid DOT: ${msg}`;
}

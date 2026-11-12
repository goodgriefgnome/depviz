import type { DepGraph, GraphNode } from "./types";

/** Test files: `*.test.*`, `*.spec.*`, and anything under `test/`, `tests/`, `spec/`, `__tests__/` or `__mocks__/`. */
export function isTestPath(path: string): boolean {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return true;
  return path.split("/").slice(0, -1).some((p) => p === "test" || p === "tests" || p === "spec" || p === "__tests__" || p === "__mocks__");
}

const isTestNode = (n: GraphNode) => n.kind === "test" || isTestPath(n.id);

/** Number of test modules in a graph. */
export function countTests(graph: DepGraph): number {
  const parents = new Set(graph.nodes.map((n) => n.parent).filter((p) => p !== undefined));
  return graph.nodes.filter((n) => !parents.has(n.id) && isTestNode(n)).length;
}

/** The graph without test modules, their edges, and any group they leave empty. */
export function withoutTests(graph: DepGraph): DepGraph {
  const parents = new Set(graph.nodes.map((n) => n.parent).filter((p) => p !== undefined));
  const drop = new Set(graph.nodes.filter((n) => !parents.has(n.id) && isTestNode(n)).map((n) => n.id));
  for (const e of graph.edges) {
    // Edge ends need not be declared as nodes.
    for (const id of [e.source, e.target]) if (!parents.has(id) && isTestPath(id)) drop.add(id);
  }
  if (!drop.size) return graph;
  // Drop groups that only held tests, innermost first.
  let changed = true;
  while (changed) {
    changed = false;
    const live = new Set(graph.nodes.filter((n) => !drop.has(n.id)).map((n) => n.parent));
    for (const id of parents) {
      if (!drop.has(id) && !live.has(id)) {
        drop.add(id);
        changed = true;
      }
    }
  }
  const graphOut: DepGraph = {
    nodes: graph.nodes.filter((n) => !drop.has(n.id)),
    edges: graph.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
  };
  if (graph.label !== undefined) graphOut.label = graph.label;
  return graphOut;
}

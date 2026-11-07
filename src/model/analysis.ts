import type { GraphEdge } from "./types";

export interface CycleInfo {
  /** Node id -> cycle number, for nodes that are part of an import cycle. */
  cycleOf: Map<string, number>;
  /** Number of distinct cycles (strongly connected components larger than one node). */
  count: number;
  /** Whether an edge lies inside a cycle (both ends in the same cycle). */
  isCycleEdge(edge: GraphEdge): boolean;
}

/**
 * Finds import cycles with Tarjan's strongly-connected-components algorithm.
 * Iterative, so large graphs can't overflow the call stack.
 * Self-imports (`a -> a`) count as a cycle of their own.
 */
export function findCycles(nodeIds: Iterable<string>, edges: GraphEdge[]): CycleInfo {
  const adj = new Map<string, string[]>();
  const selfLoops = new Set<string>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (e.source === e.target) selfLoops.add(e.source);
    adj.get(e.source)?.push(e.target);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycleOf = new Map<string, number>();
  let next = 0;
  let count = 0;

  for (const start of adj.keys()) {
    if (index.has(start)) continue;
    // Each frame: node and position in its neighbour list.
    const work: Array<[string, number]> = [[start, 0]];
    index.set(start, next);
    low.set(start, next++);
    stack.push(start);
    onStack.add(start);

    while (work.length) {
      const frame = work[work.length - 1]!;
      const [v, i] = frame;
      const nbrs = adj.get(v) ?? [];
      if (i < nbrs.length) {
        frame[1]++;
        const w = nbrs[i]!;
        if (!index.has(w)) {
          if (!adj.has(w)) continue; // edge to a node outside the set
          index.set(w, next);
          low.set(w, next++);
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent[0], Math.min(low.get(parent[0])!, low.get(v)!));
      if (low.get(v) === index.get(v)) {
        const members: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          members.push(w);
        } while (w !== v);
        if (members.length > 1 || selfLoops.has(v)) {
          count++;
          for (const m of members) cycleOf.set(m, count);
        }
      }
    }
  }

  return {
    cycleOf,
    count,
    isCycleEdge: (e) => {
      const c = cycleOf.get(e.source);
      return c !== undefined && c === cycleOf.get(e.target);
    },
  };
}

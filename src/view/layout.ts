import type { ELK, ElkExtendedEdge, ElkNode, LayoutOptions } from "elkjs/lib/elk-api";
import type { Pos } from "./model";

export type LayoutName = "layered" | "grouped" | "organic";

export const LAYOUT_NAMES: Record<LayoutName, string> = {
  layered: "Layered",
  grouped: "By folder",
  organic: "Organic",
};

/**
 * `lift: false`: one layout over everything, edges crossing folders included.
 * `lift: true`: each folder is laid out on its own; an edge that crosses
 * folders becomes an edge between the two sibling boxes that contain its ends.
 */
const LAYOUTS: Record<LayoutName, { lift: boolean; opts: LayoutOptions }> = {
  layered: {
    lift: false,
    opts: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "44",
      "elk.spacing.nodeNode": "18",
      "elk.spacing.componentComponent": "28",
    },
  },
  grouped: {
    lift: true,
    opts: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "34",
      "elk.spacing.nodeNode": "16",
      "elk.spacing.componentComponent": "24",
    },
  },
  organic: {
    lift: true,
    opts: { "elk.algorithm": "force", "elk.force.iterations": "400", "elk.spacing.nodeNode": "28" },
  },
};

export interface LayoutNode {
  id: string;
  parent?: string;
  /** Size of a box. Omitted for containers, which ELK sizes around their contents. */
  width?: number;
  height?: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

const ROOT_PADDING = "[top=20,left=20,bottom=20,right=20]";
/** Extra room at the top of a container for its label. */
const CONTAINER_PADDING = "[top=30,left=14,bottom=14,right=14]";

/** Builds the nested graph ELK lays out. */
export function buildElkGraph(nodes: LayoutNode[], edges: LayoutEdge[], name: LayoutName): ElkNode {
  const cfg = LAYOUTS[name];
  const root: ElkNode = { id: "__root", layoutOptions: { ...cfg.opts, "elk.padding": ROOT_PADDING }, children: [], edges: [] };
  const containerOpts: LayoutOptions = { ...cfg.opts, "elk.padding": CONTAINER_PADDING };
  delete containerOpts["elk.hierarchyHandling"];

  const parentOf = new Map<string, string | undefined>();
  const elk = new Map<string, ElkNode>();
  const isParent = new Set(nodes.map((n) => n.parent).filter((p): p is string => p !== undefined));
  for (const n of nodes) {
    parentOf.set(n.id, n.parent);
    elk.set(
      n.id,
      isParent.has(n.id)
        ? { id: n.id, layoutOptions: containerOpts, children: [], edges: [] }
        : { id: n.id, width: n.width ?? 40, height: n.height ?? 24 },
    );
  }
  for (const n of nodes) {
    const container = n.parent === undefined ? root : elk.get(n.parent);
    container?.children!.push(elk.get(n.id)!);
  }

  const chain = (id: string) => {
    const c = [id];
    for (let p = parentOf.get(id); p !== undefined; p = parentOf.get(p)) c.push(p);
    return c;
  };
  const seen = new Set<string>();
  for (const e of edges) {
    if (!cfg.lift) {
      root.edges!.push({ id: e.id, sources: [e.source], targets: [e.target] });
      continue;
    }
    // Find the innermost container holding both ends, and the boxes directly inside it.
    const sc = chain(e.source);
    const tc = chain(e.target);
    const tset = new Set(tc);
    const i = sc.findIndex((id) => tset.has(id));
    const shared = i < 0 ? undefined : sc[i];
    const from = i < 0 ? sc[sc.length - 1]! : sc[i - 1];
    const to = shared === undefined ? tc[tc.length - 1]! : tc[tc.indexOf(shared) - 1];
    if (from === undefined || to === undefined || from === to) continue; // an edge into its own container
    const key = JSON.stringify([from, to]);
    if (seen.has(key)) continue;
    seen.add(key);
    const edge: ElkExtendedEdge = { id: `lift${seen.size}`, sources: [from], targets: [to] };
    (shared === undefined ? root : elk.get(shared)!).edges!.push(edge);
  }
  return root;
}

/** Centre positions of the boxes in a laid-out ELK graph. */
export function positionsFrom(graph: ElkNode): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const c of node.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      if (c.children?.length) walk(c, x, y);
      else pos.set(c.id, { x: x + (c.width ?? 0) / 2, y: y + (c.height ?? 0) / 2 });
    }
  };
  walk(graph, 0, 0);
  return pos;
}

export async function computeLayout(elk: ELK, nodes: LayoutNode[], edges: LayoutEdge[], name: LayoutName): Promise<Map<string, Pos>> {
  return positionsFrom(await elk.layout(buildElkGraph(nodes, edges, name)));
}

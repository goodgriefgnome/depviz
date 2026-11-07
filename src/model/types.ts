/**
 * The input graph: a flat list of nodes and directed edges.
 *
 * Every importer (DOT, GraphML, JSON Graph Format, the JS import reader)
 * produces this shape. Nesting is optional: a node may name its `parent`
 * explicitly, otherwise the folder tree is inferred from `/` in node ids
 * (see `buildHierarchy`).
 */
export interface DepGraph {
  label?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  /** Unique id. For code, usually a repo-relative path such as `src/lib/api.js`. */
  id: string;
  /** Display name. Defaults to the last path segment of `id`. */
  label?: string;
  /** Id of the containing group. Takes precedence over path inference. */
  parent?: string;
  /** Free-form classification, e.g. `module`, `package`, `test`. */
  kind?: string;
  /** Anything else the source format carried. Preserved on export. */
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  /** Id of the importing node. */
  source: string;
  /** Id of the imported node. */
  target: string;
  metadata?: Record<string, unknown>;
}

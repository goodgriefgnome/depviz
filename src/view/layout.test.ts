import type { ElkNode } from "elkjs/lib/elk-api";
import { describe, expect, it } from "vitest";
import { buildElkGraph, positionsFrom } from "./layout";

const nodes = [
  { id: "src/" },
  { id: "src/lib/", parent: "src/" },
  { id: "src/lib/a.js", parent: "src/lib/", width: 60, height: 20 },
  { id: "src/ui/", parent: "src/" },
  { id: "src/ui/b.js", parent: "src/ui/", width: 60, height: 20 },
  { id: "top.js", width: 50, height: 20 },
];
const edges = [
  { id: "e1", source: "src/lib/a.js", target: "src/ui/b.js" },
  { id: "e2", source: "top.js", target: "src/lib/a.js" },
  { id: "e3", source: "top.js", target: "src/ui/b.js" },
];
const find = (g: ElkNode, id: string): ElkNode | undefined => (g.id === id ? g : g.children?.map((c) => find(c, id)).find(Boolean));
const edgeEnds = (g: ElkNode) => (g.edges ?? []).map((e) => `${(e as { sources: string[] }).sources[0]}>${(e as { targets: string[] }).targets[0]}`);

describe("buildElkGraph", () => {
  it("nests containers and keeps real edges at the root for the layered layout", () => {
    const g = buildElkGraph(nodes, edges, "layered");
    expect(g.children!.map((c) => c.id)).toEqual(["src/", "top.js"]);
    expect(find(g, "src/lib/")!.children!.map((c) => c.id)).toEqual(["src/lib/a.js"]);
    expect(edgeEnds(g)).toEqual(["src/lib/a.js>src/ui/b.js", "top.js>src/lib/a.js", "top.js>src/ui/b.js"]);
    expect(g.layoutOptions!["elk.hierarchyHandling"]).toBe("INCLUDE_CHILDREN");
    expect(find(g, "src/")!.layoutOptions!["elk.hierarchyHandling"]).toBeUndefined();
  });

  it("lifts edges to sibling boxes in the innermost shared container for per-folder layouts", () => {
    const g = buildElkGraph(nodes, edges, "grouped");
    // a.js -> b.js lives in src/ as lib/ -> ui/.
    expect(edgeEnds(find(g, "src/")!)).toEqual(["src/lib/>src/ui/"]);
    // Both top.js edges become one top.js -> src/ edge at the root.
    expect(edgeEnds(g)).toEqual(["top.js>src/"]);
  });

  it("gives boxes a default size", () => {
    const g = buildElkGraph([{ id: "x" }], [], "organic");
    expect(g.children![0]).toMatchObject({ width: 40, height: 24 });
  });
});

describe("positionsFrom", () => {
  it("returns box centres in absolute coordinates", () => {
    const laidOut: ElkNode = {
      id: "__root",
      children: [{ id: "src/", x: 100, y: 50, children: [{ id: "a", x: 10, y: 20, width: 40, height: 10 }] }, { id: "b", x: 0, y: 0, width: 20, height: 20 }],
    };
    expect(Object.fromEntries(positionsFrom(laidOut))).toEqual({ a: { x: 130, y: 75 }, b: { x: 10, y: 10 } });
  });
});

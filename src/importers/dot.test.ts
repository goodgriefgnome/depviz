import { describe, expect, it } from "vitest";
import { buildHierarchy } from "../model/hierarchy";
import { parseDot } from "./dot";
import { ImportError } from "./types";
import depcruiseDot from "./fixtures/depcruise.dot?raw";
// Written in the format of `madge --dot`, which needs Graphviz installed to run.
import madgeDot from "./fixtures/madge.dot?raw";
const edgeList = (dot: string) => parseDot(dot).graph.edges.map((e) => `${e.source}>${e.target}`);
const node = (dot: string, id: string) => parseDot(dot).graph.nodes.find((n) => n.id === id);

describe("parseDot", () => {
  it("reads nodes and edges, including undeclared nodes", () => {
    const { graph, warnings } = parseDot(`digraph { a; a -> b; "c d" -> a }`);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c d"]);
    expect(graph.edges.map((e) => `${e.source}>${e.target}`)).toEqual(["a>b", "c d>a"]);
    expect(warnings).toEqual([]);
  });

  it("expands edge chains and groups", () => {
    expect(edgeList(`digraph { a -> b -> c; x -> {y z} }`)).toEqual(["a>b", "b>c", "x>y", "x>z"]);
  });

  it("drops ports and merges repeated edges", () => {
    expect(edgeList(`digraph { a:out -> b:in:n; a -> b; a -> b }`)).toEqual(["a>b"]);
  });

  it("keeps attributes as metadata and uses label as the display name", () => {
    const { graph } = parseDot(`digraph { node [shape=box]; a [label="Alpha" color=red]; a -> b [style=dashed] }`);
    const a = graph.nodes.find((n) => n.id === "a")!;
    expect(a.label).toBe("Alpha");
    expect(a.metadata).toEqual({ attributes: { label: "Alpha", color: "red" } });
    expect(graph.edges[0]!.metadata).toEqual({ attributes: { style: "dashed" } });
  });

  it("turns HTML and escaped labels into plain text", () => {
    expect(node(`digraph { a [label=<<b>Big</b><br/>&amp; bold>] }`, "a")!.label).toBe("Big & bold");
    expect(node(`digraph { a [label="line one\\nline \\"two\\""] }`, "a")!.label).toBe('line one line "two"');
    // A label equal to the id, or the default \\N, adds nothing.
    expect(node(`digraph { a [label="\\N"] }`, "a")!.label).toBeUndefined();
  });

  it("turns clusters into nested groups and ignores other subgraphs", () => {
    const { graph } = parseDot(`digraph {
      subgraph cluster_outer { label="Outer"; a;
        subgraph cluster_inner { b; { rank=same; c } }
      }
      subgraph ranks { d }
    }`);
    const parent = Object.fromEntries(graph.nodes.map((n) => [n.id, n.parent]));
    expect(parent).toEqual({ cluster_outer: undefined, cluster_inner: "cluster_outer", a: "cluster_outer", b: "cluster_inner", c: "cluster_inner", d: undefined });
    expect(graph.nodes.find((n) => n.id === "cluster_outer")!.label).toBe("Outer");
    expect(graph.nodes.find((n) => n.id === "cluster_inner")!.label).toBe("inner");
  });

  it("puts a node in a cluster even if it was mentioned at the top level first", () => {
    expect(node(`digraph { a -> b; subgraph cluster_x { b } }`, "b")!.parent).toBe("cluster_x");
  });

  it("keeps a node in its first cluster and warns when another cluster claims it", () => {
    const { graph, warnings } = parseDot(`digraph { subgraph cluster_a { n } subgraph cluster_b { n } }`);
    expect(graph.nodes.find((n) => n.id === "n")!.parent).toBe("cluster_a");
    expect(warnings[0]).toMatch(/more than one cluster/);
  });

  it("renames a cluster whose name clashes with a node", () => {
    const { graph, warnings } = parseDot(`digraph { subgraph cluster_x { a } cluster_x -> a }`);
    expect(graph.nodes.find((n) => n.id === "a")!.parent).toBe("cluster_x (cluster)");
    expect(graph.nodes.find((n) => n.id === "cluster_x")!.parent).toBeUndefined();
    expect(warnings[0]).toMatch(/renamed/);
  });

  it("reads undirected graphs left to right, with a warning", () => {
    const { graph, warnings } = parseDot(`graph { a -- b }`);
    expect(graph.edges).toEqual([{ source: "a", target: "b" }]);
    expect(warnings[0]).toMatch(/undirected/);
  });

  it("uses the graph label, or else its name, as the title", () => {
    expect(parseDot(`digraph deps { a }`).graph.label).toBe("deps");
    expect(parseDot(`digraph deps { label="My <b>app</b>"; a }`).graph.label).toBe("My <b>app</b>");
    expect(parseDot(`digraph { a }`).graph.label).toBeUndefined();
  });

  it("explains syntax errors with a line and column", () => {
    expect(() => parseDot(`digraph {\n  a -> ;\n}`)).toThrow(ImportError);
    expect(() => parseDot(`digraph {\n  a -> ;\n}`)).toThrow(/line 2, column \d+/);
    expect(() => parseDot(`digraph { a`)).toThrow(/end of the file/);
    expect(() => parseDot(``)).toThrow(ImportError);
  });

  it("handles graphs larger than the parser's default limits", () => {
    const lines = Array.from({ length: 40_000 }, (_, i) => `"m${i}.js" -> "m${i + 1}.js";`);
    const { graph } = parseDot(`digraph {\n${lines.join("\n")}\n}`);
    expect(graph.edges).toHaveLength(40_000);
  });
});

describe("real tool output", () => {
  it("reads dependency-cruiser's clustered output (reopened clusters, HTML labels)", () => {
    const { graph, warnings } = parseDot(depcruiseDot);
    expect(warnings).toEqual([]);
    expect(graph.label).toBe("dependency-cruiser output");
    expect(graph.edges).toHaveLength(4);
    const h = buildHierarchy(graph);
    const path = (id: string): string[] => {
      const n = h.nodes.get(id)!;
      return n.parent ? [...path(n.parent), n.label] : [n.label];
    };
    expect(path("src/lib/api/client.js")).toEqual(["src", "lib", "api", "client.js"]);
    expect(path("src/ui/button.js")).toEqual(["src", "ui", "button.js"]);
    expect(path("src/main.js")).toEqual(["src", "main.js"]);
    expect(h.roots).toEqual(["cluster_src"]);
  });

  it("reads madge-style flat output and infers folders from paths", () => {
    const { graph, warnings } = parseDot(madgeDot);
    expect(warnings).toEqual([]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(4);
    const h = buildHierarchy(graph);
    expect(h.nodes.get("src/lib/api/client.js")!.parent).toBe("src/lib/api/");
    expect(h.nodes.get("src/lib/api/")!.label).toBe("lib/api/"); // single-folder chain merged
  });
});

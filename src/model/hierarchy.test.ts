import { describe, expect, it } from "vitest";
import { ancestors, buildHierarchy, descendants, pathSegments } from "./hierarchy";
import type { DepGraph } from "./types";

const tree = (g: DepGraph, opts = {}) => {
  const h = buildHierarchy(g, opts);
  const show = (id: string): unknown => {
    const n = h.nodes.get(id)!;
    return n.children.length ? { [`${n.label} (${n.kind})`]: n.children.map(show) } : `${n.label} (${n.kind})`;
  };
  return { h, shape: h.roots.map(show) };
};

describe("pathSegments", () => {
  it("normalises separators and dot segments", () => {
    expect(pathSegments("./src//lib/a.js")).toEqual(["src", "lib", "a.js"]);
    expect(pathSegments("src\\lib\\a.js")).toEqual(["src", "lib", "a.js"]);
    expect(pathSegments("/abs/path/")).toEqual(["abs", "path"]);
    expect(pathSegments("react")).toEqual(["react"]);
  });
});

describe("buildHierarchy", () => {
  it("infers folders from paths", () => {
    const { shape } = tree({
      nodes: [],
      edges: [
        { source: "src/main.js", target: "src/lib/api.js" },
        { source: "src/lib/api.js", target: "src/lib/util/fmt.js" },
      ],
    });
    expect(shape).toEqual([
      { "src/ (folder)": [{ "lib/ (folder)": [{ "util/ (folder)": ["fmt.js (leaf)"] }, "api.js (leaf)"] }, "main.js (leaf)"] },
    ]);
  });

  it("creates nodes for undeclared edge endpoints and keeps declared labels", () => {
    const { h } = tree({ nodes: [{ id: "a", label: "Alpha" }], edges: [{ source: "a", target: "b" }] });
    expect(h.nodes.get("a")!.label).toBe("Alpha");
    expect(h.nodes.get("b")!.kind).toBe("leaf");
    expect(h.edges).toHaveLength(1);
  });

  it("prefers explicit parents over paths", () => {
    const { shape } = tree({
      nodes: [
        { id: "core", label: "Core" },
        { id: "src/a.js", parent: "core" },
        { id: "src/b.js" },
      ],
      edges: [],
    });
    expect(shape).toEqual([{ "Core (group)": ["a.js (leaf)"] }, { "src/ (folder)": ["b.js (leaf)"] }]);
  });

  it("can turn path inference off", () => {
    const { h } = tree({ nodes: [{ id: "src/a.js" }], edges: [] }, { inferFromPaths: false });
    expect(h.roots).toEqual(["src/a.js"]);
  });

  it("compacts chains of single folders", () => {
    const { shape } = tree({ nodes: [{ id: "home/me/proj/src/a.js" }, { id: "home/me/proj/src/b.js" }], edges: [] });
    expect(shape).toEqual([{ "home/me/proj/src/ (folder)": ["a.js (leaf)", "b.js (leaf)"] }]);
  });

  it("does not compact a folder that also holds files", () => {
    const { shape } = tree({ nodes: [{ id: "src/main.js" }, { id: "src/lib/x/a.js" }], edges: [] });
    expect(shape).toEqual([{ "src/ (folder)": [{ "lib/x/ (folder)": ["a.js (leaf)"] }, "main.js (leaf)"] }]);
  });

  it("avoids id clashes between a node and an inferred folder", () => {
    const { h } = tree({ nodes: [{ id: "lib/" }, { id: "lib/a.js" }], edges: [] }, { compactFolders: false });
    const folder = h.nodes.get("lib/a.js")!.parent!;
    expect(folder).not.toBe("lib/");
    expect(h.nodes.get(folder)!.kind).toBe("folder");
  });

  it("repairs missing parents and nesting loops, with warnings", () => {
    const { h } = tree({
      nodes: [
        { id: "x", parent: "ghost" },
        { id: "p", parent: "q" },
        { id: "q", parent: "p" },
      ],
      edges: [],
    });
    expect(h.nodes.get("ghost")!.kind).toBe("group");
    expect(h.warnings.some((w) => w.includes("ghost"))).toBe(true);
    expect(h.warnings.some((w) => w.includes("loop"))).toBe(true);
    // No node is its own ancestor.
    for (const id of h.nodes.keys()) expect(ancestors(h, id)).not.toContain(id);
  });

  it("sets depths and walks descendants and ancestors", () => {
    const { h } = tree({ nodes: [{ id: "a/b/c.js" }, { id: "a/d.js" }], edges: [] });
    expect(h.nodes.get("a/b/c.js")!.depth).toBe(2);
    expect(descendants(h, "a/")).toEqual(["a/b/", "a/b/c.js", "a/d.js"]);
    expect(ancestors(h, "a/b/c.js")).toEqual(["a/b/", "a/"]);
  });
});

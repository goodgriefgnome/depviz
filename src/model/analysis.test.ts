import { describe, expect, it } from "vitest";
import { findCycles } from "./analysis";

const e = (source: string, target: string) => ({ source, target });

describe("findCycles", () => {
  it("finds no cycles in a DAG", () => {
    const c = findCycles(["a", "b", "c"], [e("a", "b"), e("b", "c"), e("a", "c")]);
    expect(c.count).toBe(0);
  });

  it("finds separate cycles and marks their edges", () => {
    const edges = [e("a", "b"), e("b", "a"), e("b", "c"), e("c", "d"), e("d", "e"), e("e", "c")];
    const c = findCycles(["a", "b", "c", "d", "e"], edges);
    expect(c.count).toBe(2);
    expect(c.cycleOf.get("a")).toBe(c.cycleOf.get("b"));
    expect(c.cycleOf.get("c")).toBe(c.cycleOf.get("e"));
    expect(c.cycleOf.get("a")).not.toBe(c.cycleOf.get("c"));
    expect(c.isCycleEdge(e("b", "c"))).toBe(false);
    expect(c.isCycleEdge(e("e", "c"))).toBe(true);
  });

  it("counts a self-import as a cycle", () => {
    const c = findCycles(["a"], [e("a", "a")]);
    expect(c.count).toBe(1);
  });

  it("ignores edges to unknown nodes", () => {
    const c = findCycles(["a"], [e("a", "zzz")]);
    expect(c.count).toBe(0);
  });

  it("handles long chains without recursion limits", () => {
    const n = 50_000;
    const ids = Array.from({ length: n }, (_, i) => `n${i}`);
    const edges = ids.slice(1).map((id, i) => e(ids[i]!, id));
    edges.push(e(ids[n - 1]!, ids[0]!));
    const c = findCycles(ids, edges);
    expect(c.count).toBe(1);
    expect(c.cycleOf.size).toBe(n);
  });
});

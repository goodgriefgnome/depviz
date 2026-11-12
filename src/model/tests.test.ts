import { describe, expect, it } from "vitest";
import { countTests, isTestPath, withoutTests } from "./tests";

describe("test files", () => {
  it("recognises test paths", () => {
    expect(isTestPath("src/a.test.ts")).toBe(true);
    expect(isTestPath("src/a.spec.jsx")).toBe(true);
    expect(isTestPath("src/__tests__/a.js")).toBe(true);
    expect(isTestPath("test/helpers.js")).toBe(true);
    expect(isTestPath("src/testing.js")).toBe(false);
    expect(isTestPath("src/latest.js")).toBe(false);
  });

  it("removes tests, their edges and groups left empty", () => {
    const g = {
      nodes: [{ id: "a.js" }, { id: "t", label: "tests" }, { id: "x", parent: "t", kind: "test" }, { id: "b.test.js" }],
      edges: [
        { source: "x", target: "a.js" },
        { source: "b.test.js", target: "a.js" },
        { source: "spec/c.js", target: "a.js" },
      ],
    };
    expect(countTests(g)).toBe(2);
    expect(withoutTests(g)).toEqual({ nodes: [{ id: "a.js" }], edges: [] });
  });
});

import { describe, expect, it } from "vitest";
import { buildHierarchy } from "../model/hierarchy";
import { ViewModel } from "./model";

/**
 * src/
 *   main.js -> lib/a.js, ui/b.js
 *   lib/a.js -> lib/c.js, ui/b.js
 *   lib/c.js
 *   ui/b.js -> lib/a.js        (cycle a <-> b)
 */
const vmFor = () =>
  new ViewModel(
    buildHierarchy({
      nodes: [],
      edges: [
        { source: "src/main.js", target: "src/lib/a.js" },
        { source: "src/main.js", target: "src/ui/b.js" },
        { source: "src/lib/a.js", target: "src/lib/c.js" },
        { source: "src/lib/a.js", target: "src/ui/b.js" },
        { source: "src/ui/b.js", target: "src/lib/a.js" },
      ],
    }),
  );

const edges = (vm: ViewModel) => vm.visibleEdges().map((e) => `${e.source}>${e.target}×${e.count}${e.cycle ? "!" : ""}`);

describe("ViewModel", () => {
  it("shows everything when nothing is collapsed", () => {
    const vm = vmFor();
    expect(vm.visibleNodes().map((n) => `${n.id}:${n.kind}`)).toEqual([
      "src/:open",
      "src/lib/:open",
      "src/lib/a.js:leaf",
      "src/lib/c.js:leaf",
      "src/ui/:open",
      "src/ui/b.js:leaf",
      "src/main.js:leaf",
    ]);
    expect(edges(vm)).toContain("src/lib/a.js>src/ui/b.js×1!");
    expect(vm.visibleNodes().find((n) => n.id === "src/main.js")!.unused).toBe(true);
  });

  it("merges edges into collapsed folders and drops edges inside them", () => {
    const vm = vmFor();
    vm.collapse("src/lib/");
    expect(vm.rep("src/lib/c.js")).toBe("src/lib/");
    expect(edges(vm).sort()).toEqual(["src/lib/>src/ui/b.js×1!", "src/main.js>src/lib/×1", "src/main.js>src/ui/b.js×1", "src/ui/b.js>src/lib/×1!"]);
    vm.collapse("src/ui/");
    expect(edges(vm).sort()).toEqual(["src/lib/>src/ui/×1!", "src/main.js>src/lib/×1", "src/main.js>src/ui/×1", "src/ui/>src/lib/×1!"]);
    const merged = vm.visibleEdges().find((e) => e.source === "src/main.js" && e.target === "src/lib/")!;
    expect(merged.pairs).toEqual([["src/main.js", "src/lib/a.js"]]);
  });

  it("counts merged edges", () => {
    const vm = vmFor();
    vm.collapse("src/");
    expect(vm.visibleNodes().map((n) => `${n.id}:${n.kind}:${n.leafCount}`)).toEqual(["src/:collapsed:4"]);
    expect(edges(vm)).toEqual([]);
  });

  it("places a collapsed folder at the centre of its contents and restores them, shifted, on expand", () => {
    const vm = vmFor();
    vm.pos.set("src/lib/a.js", { x: 0, y: 0 });
    vm.pos.set("src/lib/c.js", { x: 100, y: 50 });
    vm.collapse("src/lib/");
    expect(vm.pos.get("src/lib/")).toEqual({ x: 50, y: 25 });
    vm.pos.set("src/lib/", { x: 250, y: 125 }); // dragged by (200, 100)
    vm.expand("src/lib/");
    expect(vm.pos.get("src/lib/a.js")).toEqual({ x: 200, y: 100 });
    expect(vm.pos.get("src/lib/c.js")).toEqual({ x: 300, y: 150 });
  });

  it("spreads never-placed contents around the box on expand", () => {
    const vm = vmFor();
    vm.collapse("src/lib/");
    vm.pos.set("src/lib/", { x: 10, y: 10 });
    vm.expand("src/lib/");
    expect(vm.pos.has("src/lib/a.js")).toBe(true);
    expect(vm.pos.get("src/lib/a.js")).not.toEqual(vm.pos.get("src/lib/c.js"));
  });

  it("sets and recognises depth levels", () => {
    const vm = vmFor();
    expect(vm.maxContainerDepth).toBe(1);
    vm.setLevel(1);
    expect([...vm.collapsed].sort()).toEqual(["src/lib/", "src/ui/"]);
    expect(vm.currentLevel()).toBe(1);
    vm.expand("src/ui/");
    expect(vm.currentLevel()).toBeUndefined();
    vm.setLevel(null);
    expect(vm.collapsed.size).toBe(0);
    expect(vm.currentLevel()).toBeNull();
    vm.setLevel(0);
    expect(vm.currentLevel()).toBe(0);
  });

  it("picks the deepest level that fits a box budget", () => {
    const vm = vmFor();
    expect(vm.boxCountAt(0)).toBe(1);
    expect(vm.boxCountAt(1)).toBe(3);
    expect(vm.boxCountAt(null)).toBe(4);
    expect(vm.pickLevel(10)).toBeNull();
    expect(vm.pickLevel(3)).toBe(1);
    expect(vm.pickLevel(2)).toBe(0);
  });

  it("round-trips saved state and ignores ids that no longer exist", () => {
    const vm = vmFor();
    vm.collapse("src/ui/");
    vm.pos.set("src/main.js", { x: 1, y: 2 });
    const saved = vm.save();
    const again = new ViewModel(vm.h, { ...saved, collapsed: [...saved.collapsed, "gone/"], pos: { ...saved.pos, "gone.js": { x: 0, y: 0 } } });
    expect([...again.collapsed]).toEqual(["src/ui/"]);
    expect(again.pos.get("src/main.js")).toEqual({ x: 1, y: 2 });
    expect(again.pos.has("gone.js")).toBe(false);
  });
});

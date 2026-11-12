import { describe, expect, it } from "vitest";
import { plural } from "./graphView";

describe("plural", () => {
  it("pluralises the words the UI uses", () => {
    expect(plural(1, "dependency")).toBe("1 dependency");
    expect(plural(5, "dependency")).toBe("5 dependencies");
    expect(plural(2, "match")).toBe("2 matches");
    expect(plural(0, "module")).toBe("0 modules");
    expect(plural(1200, "import")).toBe("1,200 imports");
  });
});

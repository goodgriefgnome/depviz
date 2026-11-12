import { describe, expect, it } from "vitest";
import { findImports } from "./scan";

describe("findImports", () => {
  it("finds every import form", () => {
    const code = `
      import a from "./a";
      import { b, c as d } from './b';
      import * as e from "./e";
      import f, { g } from "./f";
      import "./side-effect.css";
      import type { T } from "./types";
      import x = require("./ts-require");
      export * from "./all";
      export * as ns from "./ns";
      export { h } from "./h";
      export type { U } from "./u";
      const lazy = () => import("./lazy");
      const cjs = require("./cjs");
      import json from "./data.json" with { type: "json" };
    `;
    expect(findImports(code)).toEqual([
      "./a",
      "./b",
      "./e",
      "./f",
      "./side-effect.css",
      "./types",
      "./ts-require",
      "./all",
      "./ns",
      "./h",
      "./u",
      "./lazy",
      "./cjs",
      "./data.json",
    ]);
  });

  it("handles multi-line import lists", () => {
    expect(findImports(`import {\n  a,\n  b, // note\n  from,\n} from "./x";`)).toEqual(["./x"]);
  });

  it("ignores imports inside comments, strings, templates and regexes", () => {
    const code = `
      // import a from "./no1";
      /* require("./no2") */
      const s = 'import b from "./no3"';
      const t = \`require("./no4") \${ require("./yes1") } import("./no5")\`;
      const r = /import("\\.\\/no6")/g;
      const half = 10 / 2; require("./yes2");
    `;
    expect(findImports(code)).toEqual(["./yes1", "./yes2"]);
  });

  it("skips non-literal and member calls", () => {
    expect(findImports(`require(name); import(\`./\${x}\`); obj.require("./no"); import.meta.url; foo.import("./no")`)).toEqual([]);
  });

  it("does not let an apostrophe in JSX text hide later imports", () => {
    const code = `const A = () => <p>Don't panic</p>;\nimport b from "./b";\nconst c = require("./c");`;
    expect(findImports(code)).toEqual(["./b", "./c"]);
  });

  it("does not treat an object key or export of a variable as an import", () => {
    expect(findImports(`const o = { import: "./no", require: "./no" }; export const from = "./no"; export { a };`)).toEqual([]);
  });
});

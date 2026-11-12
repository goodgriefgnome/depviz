import { describe, expect, it } from "vitest";
import { parseJsonc, Resolver } from "./resolve";

const sources = [
  "src/main.ts",
  "src/lib/api.ts",
  "src/lib/index.ts",
  "src/ui/Button.tsx",
  "src/legacy.js",
  "src/esm.mjs",
  "packages/core/src/index.ts",
  "packages/core/src/util.ts",
  "packages/web/app.js",
];
const configs = [
  { path: "tsconfig.json", text: `{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "~ui": ["src/ui/Button"], }, }, }` },
  { path: "packages/core/package.json", text: `{ "name": "@acme/core", "main": "dist/index.js" }` },
];
const r = new Resolver(sources, configs);
const res = (from: string, spec: string) => {
  const x = r.resolve(from, spec);
  return x.kind === "file" ? x.path : x.kind;
};

describe("Resolver", () => {
  it("resolves relative imports with or without extensions and index files", () => {
    expect(res("src/main.ts", "./lib/api")).toBe("src/lib/api.ts");
    expect(res("src/main.ts", "./lib")).toBe("src/lib/index.ts");
    expect(res("src/lib/api.ts", "..//legacy.js")).toBe("src/legacy.js");
    expect(res("src/lib/api.ts", "../esm.mjs")).toBe("src/esm.mjs");
    expect(res("src/lib/api.ts", "../ui/Button")).toBe("src/ui/Button.tsx");
  });

  it("maps .js written in TypeScript sources to the .ts file", () => {
    expect(res("src/main.ts", "./lib/api.js")).toBe("src/lib/api.ts");
    expect(res("src/main.ts", "./ui/Button.js")).toBe("src/ui/Button.tsx");
  });

  it("drops query strings", () => {
    expect(res("src/main.ts", "./lib/api?worker")).toBe("src/lib/api.ts");
  });

  it("tells assets, missing files and packages apart", () => {
    expect(res("src/main.ts", "./styles.css")).toBe("asset");
    expect(res("src/main.ts", "./nope")).toBe("missing");
    expect(res("src/main.ts", "react")).toBe("external");
    expect(res("src/main.ts", "node:fs")).toBe("external");
    expect(res("src/main.ts", "../../outside")).toBe("external");
  });

  it("uses tsconfig paths and baseUrl", () => {
    expect(res("src/main.ts", "@/lib/api")).toBe("src/lib/api.ts");
    expect(res("src/main.ts", "~ui")).toBe("src/ui/Button.tsx");
    expect(res("src/main.ts", "src/legacy")).toBe("src/legacy.js");
  });

  it("resolves workspace packages to their source", () => {
    expect(res("packages/web/app.js", "@acme/core")).toBe("packages/core/src/index.ts");
    expect(res("packages/web/app.js", "@acme/core/src/util")).toBe("packages/core/src/util.ts");
  });

  it("follows tsconfig extends", () => {
    const r2 = new Resolver(["app/x.ts", "app/y.ts"], [
      { path: "tsconfig.base.json", text: `{"compilerOptions":{"paths":{"#/*":["app/*"]}}}` },
      { path: "tsconfig.json", text: `{"extends":"./tsconfig.base"}` },
    ]);
    expect(r2.resolve("app/x.ts", "#/y")).toEqual({ kind: "file", path: "app/y.ts" });
  });
});

describe("parseJsonc", () => {
  it("keeps // inside strings", () => {
    expect(parseJsonc(`{"$schema": "https://x/y", /* c */ "a": [1,],}`)).toEqual({ $schema: "https://x/y", a: [1] });
  });
});

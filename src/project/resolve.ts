import { baseName, normalise, SOURCE_EXTENSIONS, type SourceFile } from "./files";

export type Resolution =
  /** A source file in the project. */
  | { kind: "file"; path: string }
  /** An installed package, a Node built-in, or anything else outside the project. */
  | { kind: "external" }
  /** A project file that isn't JavaScript or TypeScript, like a stylesheet or JSON. */
  | { kind: "asset" }
  /** A relative import whose target isn't in the project. */
  | { kind: "missing" };

const TS_FOR_JS: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };

interface TsConfig {
  dir: string;
  /** Folder that non-relative `paths` targets and bare imports resolve against. */
  baseUrl?: string;
  paths: [pattern: string, targets: string[]][];
}

interface Package {
  dir: string;
  json: Record<string, unknown>;
}

/**
 * Resolves import specifiers the way bundlers and TypeScript mostly agree on: relative paths with
 * optional extensions and `index` files, `.js` written for a `.ts` file, tsconfig/jsconfig `paths`
 * and `baseUrl`, and imports of other packages in the same repository (workspaces).
 */
export class Resolver {
  private readonly sources: Set<string>;
  private readonly tsconfigs = new Map<string, TsConfig>();
  private readonly packages = new Map<string, Package>();

  constructor(sources: Iterable<string>, configs: SourceFile[] = []) {
    this.sources = new Set(sources);
    const raw = new Map<string, Record<string, unknown>>();
    for (const f of configs) {
      const json = parseJsonc(f.text);
      if (json) raw.set(f.path, json);
    }
    for (const [path, json] of raw) {
      const dir = dirName(path);
      const name = baseName(path);
      if (name === "package.json") {
        if (typeof json.name === "string" && !this.packages.has(json.name)) this.packages.set(json.name, { dir, json });
      } else {
        this.tsconfigs.set(dir, readTsConfig(path, raw));
      }
    }
  }

  resolve(from: string, specifier: string): Resolution {
    const spec = specifier.replace(/[?#].*$/, "") || specifier;
    if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) {
      const target = normalise(`${dirName(from)}/${spec}`);
      if (target === null) return { kind: "external" };
      return this.found(this.file(target)) ?? (hasOtherExtension(spec) ? { kind: "asset" } : { kind: "missing" });
    }
    if (spec.startsWith("/")) {
      const target = normalise(spec);
      return this.found(target === null ? null : this.file(target)) ?? { kind: "external" };
    }
    if (/^[a-z]+:/i.test(spec) && !spec.startsWith("@")) return { kind: "external" }; // node:fs, https://…, virtual:…

    const ts = this.tsconfigFor(from);
    if (ts) {
      for (const [pattern, targets] of ts.paths) {
        const star = pattern.indexOf("*");
        let rest: string | undefined;
        if (star < 0) rest = pattern === spec ? "" : undefined;
        else {
          const pre = pattern.slice(0, star);
          const post = pattern.slice(star + 1);
          if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) rest = spec.slice(pre.length, spec.length - post.length);
        }
        if (rest === undefined) continue;
        for (const t of targets) {
          const target = normalise(`${ts.baseUrl ?? ts.dir}/${t.replace("*", rest)}`);
          const hit = target === null ? null : this.file(target);
          if (hit) return { kind: "file", path: hit };
        }
        if (hasOtherExtension(spec)) return { kind: "asset" };
      }
      if (ts.baseUrl !== undefined) {
        const target = normalise(`${ts.baseUrl}/${spec}`);
        const hit = target === null ? null : this.file(target);
        if (hit) return { kind: "file", path: hit };
      }
    }

    const pkg = this.workspacePackage(spec);
    if (pkg) {
      const hit = this.packageFile(pkg.pkg, pkg.sub);
      if (hit) return { kind: "file", path: hit };
    }
    return { kind: "external" };
  }

  private found(path: string | null): Resolution | null {
    return path === null ? null : { kind: "file", path };
  }

  /** The source file a path refers to, trying extensions and `index` files. */
  file(path: string): string | null {
    const s = this.sources;
    if (s.has(path)) return path;
    const ext = /\.[cm]?jsx?$/.exec(path)?.[0];
    if (ext) {
      const stem = path.slice(0, -ext.length);
      for (const alt of TS_FOR_JS[ext] ?? []) if (s.has(stem + alt)) return stem + alt;
    }
    for (const e of SOURCE_EXTENSIONS) if (s.has(path + e)) return path + e;
    const dir = path === "" ? "" : `${path}/`;
    for (const e of SOURCE_EXTENSIONS) if (s.has(`${dir}index${e}`)) return `${dir}index${e}`;
    return null;
  }

  private tsconfigFor(from: string): TsConfig | undefined {
    for (let dir = dirName(from); ; dir = dirName(dir)) {
      const c = this.tsconfigs.get(dir);
      if (c) return c;
      if (dir === "") return undefined;
    }
  }

  private workspacePackage(spec: string): { pkg: Package; sub: string } | undefined {
    const parts = spec.split("/");
    const nameLen = spec.startsWith("@") ? 2 : 1;
    const pkg = this.packages.get(parts.slice(0, nameLen).join("/"));
    return pkg && { pkg, sub: parts.slice(nameLen).join("/") };
  }

  private packageFile(pkg: Package, sub: string): string | null {
    const at = (rel: string) => {
      const p = normalise(`${pkg.dir}/${rel}`);
      if (p === null) return null;
      // Entry points often name built output; look for the source it came from too.
      return this.file(p) ?? this.file(p.replace(/(^|\/)(dist|lib|build|out|esm|cjs)\//, "$1src/").replace(/\.d\.ts$/, ""));
    };
    const exp = exportsTarget(pkg.json.exports, sub ? `./${sub}` : ".");
    for (const t of exp) {
      const hit = at(t);
      if (hit) return hit;
    }
    if (sub) return at(sub) ?? at(`src/${sub}`);
    for (const field of ["source", "module", "main", "browser", "types", "typings"]) {
      const v = pkg.json[field];
      if (typeof v === "string") {
        const hit = at(v);
        if (hit) return hit;
      }
    }
    return at("index") ?? at("src/index") ?? at("src/main");
  }
}

/** The paths a package's `exports` field gives for a subpath, in no particular condition order. */
function exportsTarget(exports: unknown, sub: string): string[] {
  if (exports === undefined || exports === null) return [];
  const isMap = typeof exports === "object" && !Array.isArray(exports) && Object.keys(exports).some((k) => k.startsWith("."));
  let entry: unknown;
  if (isMap) {
    const map = exports as Record<string, unknown>;
    entry = map[sub];
    if (entry === undefined) {
      for (const [k, v] of Object.entries(map)) {
        const star = k.indexOf("*");
        if (star >= 0 && sub.startsWith(k.slice(0, star)) && sub.endsWith(k.slice(star + 1))) {
          const rest = sub.slice(star, sub.length - (k.length - star - 1));
          return strings(v).map((s) => s.replace("*", rest));
        }
      }
    }
  } else if (sub === ".") entry = exports;
  return strings(entry);
}

const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

function readTsConfig(path: string, all: Map<string, Record<string, unknown>>, depth = 0): TsConfig {
  const dir = dirName(path);
  const json = all.get(path) ?? {};
  let base: TsConfig = { dir, paths: [] };
  const ext = json.extends;
  const parents = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext.filter((e): e is string => typeof e === "string") : [];
  for (const p of parents) {
    if (depth > 5 || !(p.startsWith("./") || p.startsWith("../"))) continue;
    let target = normalise(`${dir}/${p}`);
    if (target !== null && !target.endsWith(".json")) target += ".json";
    if (target !== null && all.has(target)) base = readTsConfig(target, all, depth + 1);
  }
  const opts = (json.compilerOptions ?? {}) as Record<string, unknown>;
  const result: TsConfig = { dir, paths: base.paths };
  if (base.baseUrl !== undefined) result.baseUrl = base.baseUrl;
  if (typeof opts.baseUrl === "string") {
    const b = normalise(`${dir}/${opts.baseUrl}`);
    if (b !== null) result.baseUrl = b;
  }
  if (opts.paths && typeof opts.paths === "object") {
    result.paths = Object.entries(opts.paths as Record<string, unknown>).map(([k, v]) => [k, strings(v)] as [string, string[]]);
    // Without baseUrl, paths are relative to the config that declares them.
    if (result.baseUrl === undefined) result.baseUrl = dir;
  }
  return result;
}

/** JSON with comments and trailing commas, as tsconfig.json allows. Returns undefined if it can't be read. */
export function parseJsonc(text: string): Record<string, unknown> | undefined {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  try {
    const v: unknown = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export const dirName = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

/** Whether the last segment has an extension that isn't a source one, like `.css` or `.svg`. */
function hasOtherExtension(spec: string): boolean {
  const name = baseName(spec);
  const m = /\.[a-z0-9]+$/i.exec(name);
  return m !== null && !SOURCE_EXTENSIONS.includes(m[0]) && !name.startsWith(".");
}

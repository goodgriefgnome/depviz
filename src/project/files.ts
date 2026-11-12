export { isTestPath } from "../model/tests";

/** A file read from an archive or folder, with a path relative to the project root. */
export interface SourceFile {
  path: string;
  text: string;
}

/** Extensions read as JavaScript or TypeScript modules. */
export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Folders never worth reading: installed packages, VCS data, build output and caches. */
const SKIP_DIRS = new Set([
  "node_modules",
  "bower_components",
  "jspm_packages",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vercel",
  ".yarn",
  ".pnpm-store",
]);

/** Config files read for import resolution. */
const CONFIG_FILES = new Set(["package.json", "tsconfig.json", "jsconfig.json"]);

/** Files larger than this are almost always bundles or generated code. */
export const MAX_SOURCE_BYTES = 1_000_000;

export function isSourcePath(path: string): boolean {
  const name = baseName(path);
  if (name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".d.cts")) return false;
  if (/\.min\.[cm]?js$/.test(name)) return false;
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export const isConfigPath = (path: string) => CONFIG_FILES.has(baseName(path));

export const isSkippedDir = (name: string) => SKIP_DIRS.has(name);

/** True if any folder on the path is one we skip. */
export function inSkippedDir(path: string): boolean {
  const parts = path.split("/");
  parts.pop();
  return parts.some((p) => SKIP_DIRS.has(p));
}

/** Whether a file should be read at all. `path` is as stored in the archive or folder. */
export const wanted = (path: string) => !inSkippedDir(path) && (isSourcePath(path) || isConfigPath(path));

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Removes a top folder that every file shares, such as `depviz-main/` in a GitHub zip.
 * Returns that folder's name, or undefined if there was none.
 */
export function stripCommonRoot(files: SourceFile[]): string | undefined {
  const first = files[0]?.path;
  if (!first) return undefined;
  const slash = first.indexOf("/");
  if (slash < 0) return undefined;
  const prefix = first.slice(0, slash + 1);
  if (!files.every((f) => f.path.startsWith(prefix))) return undefined;
  for (const f of files) f.path = f.path.slice(prefix.length);
  return prefix.slice(0, -1);
}

/** Normalises a path: forward slashes, no leading `./` or `/`, `.` and `..` resolved. Returns null if it climbs above the root. */
export function normalise(path: string): string | null {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

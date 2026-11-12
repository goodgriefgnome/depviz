import { ImportError, type ImportResult } from "../importers/types";
import type { DepGraph, GraphEdge, GraphNode } from "../model/types";
import { isConfigPath, isSourcePath, isTestPath, stripCommonRoot, type SourceFile } from "./files";
import { parseJsonc, Resolver } from "./resolve";
import { findImports } from "./scan";

export interface ProjectInput {
  /** File, archive or folder name, used as the title if the files don't share a top folder. */
  name: string;
  files: SourceFile[];
  /** Files skipped for size. */
  tooLarge?: string[];
}

/** Builds a module graph from a project's source files: one node per file, one edge per imported file. */
export function analyseProject(input: ProjectInput): ImportResult {
  const files = input.files.map((f) => ({ ...f, path: f.path.replace(/\\/g, "/").replace(/^\.?\//, "") }));
  const root = stripCommonRoot(files);
  const sources = files.filter((f) => isSourcePath(f.path));
  if (!sources.length) throw new ImportError(`No JavaScript or TypeScript files found in "${input.name}".`);
  const resolver = new Resolver(
    sources.map((f) => f.path),
    files.filter((f) => isConfigPath(f.path)),
  );

  const nodes: GraphNode[] = sources.map((f) => (isTestPath(f.path) ? { id: f.path, kind: "test" } : { id: f.path }));
  const edges: GraphEdge[] = [];
  const missing: string[] = [];
  for (const f of sources) {
    const seen = new Set<string>();
    for (const spec of findImports(f.text)) {
      const r = resolver.resolve(f.path, spec);
      if (r.kind === "missing") missing.push(`${f.path} → ${spec}`);
      if (r.kind !== "file" || r.path === f.path || seen.has(r.path)) continue;
      seen.add(r.path);
      edges.push({ source: f.path, target: r.path });
    }
  }

  const warnings: string[] = [];
  const tooLarge = (input.tooLarge ?? []).filter((p) => isSourcePath(p));
  if (tooLarge.length) warnings.push(`Skipped ${count(tooLarge.length, "file")} over 1 MB, probably bundles: ${examples(tooLarge)}.`);
  if (missing.length) warnings.push(`${count(missing.length, "relative import")} pointed at files that aren't here: ${examples(missing)}.`);

  const pkgName = parseJsonc(files.find((f) => f.path === "package.json")?.text ?? "")?.name;
  const label = typeof pkgName === "string" && pkgName ? pkgName : (root ?? input.name.replace(/\.(zip|tar|tgz|tar\.gz)$/i, ""));
  const graph: DepGraph = { label, nodes, edges };
  return { graph, warnings };
}

const count = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const examples = (items: string[]) => items.slice(0, 3).join(", ") + (items.length > 3 ? ` and ${items.length - 3} more` : "");

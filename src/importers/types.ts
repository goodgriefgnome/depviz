import type { DepGraph } from "../model/types";

export interface ImportResult {
  graph: DepGraph;
  /** Things the importer skipped or changed, for display to the user. */
  warnings: string[];
}

/** A file that couldn't be read. The message is written for the user. */
export class ImportError extends Error {
  override name = "ImportError";
}

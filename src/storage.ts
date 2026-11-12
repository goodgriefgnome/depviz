import type { Hierarchy } from "./model/hierarchy";
import type { DepGraph } from "./model/types";
import type { LayoutName } from "./view/layout";
import type { SavedView } from "./view/model";

/** All storage goes through here: it can be unavailable (private mode, quota) and must never break the app. */
function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** A short fingerprint of a graph's nodes, so each graph keeps its own layout. */
export function graphKey(h: Hierarchy): string {
  let hash = 0x811c9dc5;
  for (const id of [...h.nodes.keys()].sort()) {
    for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
    hash = Math.imul(hash ^ 0x0a, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export const loadView = (key: string) => read<SavedView>(`depviz:view:${key}`);
export const saveView = (key: string, view: SavedView) => write(`depviz:view:${key}`, view);
export const clearView = (key: string) => {
  try {
    localStorage.removeItem(`depviz:view:${key}`);
  } catch {
    // ignore
  }
};

export interface Prefs {
  layout: LayoutName;
  autoArrange: boolean;
  showTests: boolean;
}
export const loadPrefs = (): Partial<Prefs> => read<Partial<Prefs>>("depviz:prefs") ?? {};
export const savePrefs = (p: Prefs) => write("depviz:prefs", p);

/**
 * The last graph opened, so a reload comes back to it: DOT as text, a project as the graph read
 * from it (the source files themselves are not kept). Large ones are not kept.
 */
export type LastFile = { name: string; text: string; warnings?: undefined } | { name: string; graph: DepGraph; warnings: string[] };
const MAX_REMEMBERED = 2_000_000;
export const loadLastFile = () => read<LastFile>("depviz:last");
export const saveLastFile = (f: LastFile): boolean => {
  const json = JSON.stringify(f);
  if (json.length > MAX_REMEMBERED) {
    forgetLastFile();
    return false;
  }
  try {
    localStorage.setItem("depviz:last", json);
    return true;
  } catch {
    return false;
  }
};
export const forgetLastFile = () => {
  try {
    localStorage.removeItem("depviz:last");
  } catch {
    // ignore
  }
};

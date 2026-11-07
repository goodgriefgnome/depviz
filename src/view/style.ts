import type cytoscape from "cytoscape";

const TOKENS = ["bg", "surface", "fg", "muted", "line", "accent", "in", "cycle", "group-a", "group-b", "leaf", "leaf-border", "edge"] as const;
type Tokens = Record<(typeof TOKENS)[number], string>;

/** Reads the colour tokens defined in styles.css, so the graph follows the page theme. */
function readTokens(): Tokens {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map((k) => [k, cs.getPropertyValue(`--${k}`).trim()])) as Tokens;
}

export const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const SANS = '"IBM Plex Sans", system-ui, sans-serif';

/** Approximate box size for a label in the 11px mono font. */
export function boxSize(label: string): { w: number; h: number } {
  const lines = label.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  return { w: Math.max(36, longest * 6.9 + 20), h: 14 * lines.length + 12 };
}

export function graphStyle(): cytoscape.StylesheetJson {
  const t = readTokens();
  // Style values are checked loosely: cytoscape's types don't cover data() mappers well.
  const rules: Array<{ selector: string; style: Record<string, unknown> }> = [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-family": MONO,
        "font-size": 11,
        color: t.fg,
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        shape: "round-rectangle",
        "background-color": t.leaf,
        "border-width": 1,
        "border-color": t["leaf-border"],
        "overlay-opacity": 0,
      },
    },
    { selector: "node:childless", style: { width: "data(w)", height: "data(h)" } },
    { selector: "node.unused", style: { "border-style": "dashed", color: t.muted } },
    {
      selector: "node.open",
      style: {
        shape: "round-rectangle",
        "background-color": t["group-a"],
        "border-color": t.line,
        "border-width": 1,
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -3,
        "font-family": SANS,
        "font-size": 11,
        "font-weight": 600,
        color: t.muted,
        padding: "14px",
      },
    },
    { selector: "node.open.odd", style: { "background-color": t["group-b"] } },
    {
      selector: "node.collapsed",
      style: {
        "background-color": t["group-b"],
        "border-width": 3,
        "border-style": "double",
        "border-color": t["leaf-border"],
        "font-family": SANS,
        "font-weight": 600,
        "font-size": 12,
        "line-height": 1.35,
      },
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        "line-color": t.edge,
        "target-arrow-color": t.edge,
        width: "data(w)",
        opacity: 0.9,
        "overlay-opacity": 0,
      },
    },
    {
      selector: "edge[count > 1]",
      style: {
        label: "data(count)",
        "font-family": MONO,
        "font-size": 10,
        color: t.muted,
        "text-background-color": t.bg,
        "text-background-opacity": 1,
        "text-background-padding": "2px",
        "text-background-shape": "round-rectangle",
      },
    },
    { selector: "edge.cycle", style: { "line-color": t.cycle, "target-arrow-color": t.cycle, "line-style": "dashed" } },
    { selector: ".dim", style: { opacity: 0.16 } },
    // Dimming a container would also dim its contents, so fade only its own outline and label.
    { selector: "node.open.dim", style: { opacity: 1, "text-opacity": 0.45, "border-opacity": 0.5 } },
    { selector: "edge.out", style: { "line-color": t.accent, "target-arrow-color": t.accent, opacity: 1, "z-index": 10 } },
    { selector: "edge.in", style: { "line-color": t.in, "target-arrow-color": t.in, opacity: 1, "z-index": 10 } },
    { selector: "edge.out, edge.in", style: { width: "mapData(count, 1, 10, 3, 8)" } },
    { selector: "node.outn", style: { "border-color": t.accent, "border-width": 2 } },
    { selector: "node.inn", style: { "border-color": t.in, "border-width": 2 } },
    { selector: "node.focus", style: { "border-color": t.fg, "border-width": 3 } },
    {
      selector: "node.match",
      style: { "underlay-color": t.accent, "underlay-opacity": 0.28, "underlay-padding": 7, "underlay-shape": "round-rectangle" },
    },
  ];
  return rules as cytoscape.StylesheetJson;
}

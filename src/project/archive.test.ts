import { describe, expect, it } from "vitest";
import { analyseProject } from "./analyse";
import { archiveKind, readArchive } from "./archive";
import { wanted } from "./files";

const enc = new TextEncoder();

async function compress(data: Uint8Array, format: "gzip" | "deflate-raw"): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A minimal ustar writer; names over 100 bytes get a pax header like GitHub's tarballs. */
function tar(files: Record<string, string>): Uint8Array {
  const blocks: Uint8Array[] = [];
  const header = (name: string, size: number, type: string) => {
    const h = new Uint8Array(512);
    h.set(enc.encode(name.slice(0, 100)), 0);
    h.set(enc.encode(size.toString(8).padStart(11, "0")), 124);
    h[156] = type.charCodeAt(0);
    h.set(enc.encode("ustar\u000000"), 257);
    return h;
  };
  const body = (data: Uint8Array) => {
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    return padded;
  };
  const global = enc.encode("52 comment=0123456789abcdef0123456789abcdef01234567\n");
  blocks.push(header("pax_global_header", global.length, "g"), body(global));
  for (const [name, text] of Object.entries(files)) {
    const data = enc.encode(text);
    if (name.length > 100) {
      const rec = ` path=${name}\n`;
      let len = rec.length + 2;
      len = rec.length + String(len).length;
      const pax = enc.encode(`${len}${rec}`);
      blocks.push(header("PaxHeader", pax.length, "x"), body(pax));
    }
    blocks.push(header(name, data.length, "0"), body(data));
  }
  blocks.push(new Uint8Array(1024));
  return concat(blocks);
}

/** A minimal zip writer (deflate, no data descriptors). */
async function zip(files: Record<string, string>): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const data = await compress(raw, "deflate-raw");
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(8, 8, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameBytes.length, true);
    locals.push(new Uint8Array(lh.buffer), nameBytes, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(10, 8, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = concat(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cd.length, true);
  end.setUint32(16, offset, true);
  return concat([...locals, cd, new Uint8Array(end.buffer)]);
}

const deep = `repo-main/src/${"very-long-folder-name/".repeat(5)}deep.js`;
const project = {
  "repo-main/package.json": `{"name":"repo"}`,
  "repo-main/README.md": "# hi",
  "repo-main/src/main.js": `import { a } from "./lib/a.js";\nimport "./${"very-long-folder-name/".repeat(5)}deep";\nimport React from "react";`,
  "repo-main/src/lib/a.js": `export const a = require("./missing");`,
  "repo-main/src/lib/a.test.js": `import { a } from "./a";`,
  "repo-main/node_modules/react/index.js": `module.exports = {}`,
  [deep]: `export default 1;`,
};

describe("readArchive", () => {
  it("recognises archive types", async () => {
    expect(archiveKind(await zip({ a: "" }))).toBe("zip");
    expect(archiveKind(tar({ a: "" }))).toBe("tar");
    expect(archiveKind(await compress(tar({ a: "" }), "gzip"))).toBe("gzip");
    expect(archiveKind(enc.encode("digraph {}"))).toBeNull();
  });

  const expected = ["repo-main/package.json", deep, "repo-main/src/lib/a.js", "repo-main/src/lib/a.test.js", "repo-main/src/main.js"].sort();

  it("reads wanted files from a zip", async () => {
    const r = await readArchive(await zip(project), wanted);
    expect(r.files.map((f) => f.path)).toEqual(expected);
    expect(r.files.find((f) => f.path === deep)!.text).toBe("export default 1;");
  });

  it("reads wanted files from a .tar.gz, including pax long names", async () => {
    const r = await readArchive(await compress(tar(project), "gzip"), wanted);
    expect(r.files.map((f) => f.path)).toEqual(expected);
  });

  it("rejects other files", async () => {
    await expect(readArchive(enc.encode("hello"), wanted)).rejects.toThrow(/isn't a zip/);
  });
});

describe("analyseProject", () => {
  it("builds a module graph from an archive", async () => {
    const { files } = await readArchive(await zip(project), wanted);
    const { graph, warnings } = analyseProject({ name: "repo-main.zip", files });
    expect(graph.label).toBe("repo"); // from package.json
    expect(graph.nodes).toEqual([
      { id: "src/lib/a.js" },
      { id: "src/lib/a.test.js", kind: "test" },
      { id: "src/main.js" },
      { id: deep.slice("repo-main/".length) },
    ]);
    expect(graph.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual([
      "src/lib/a.test.js>src/lib/a.js",
      "src/main.js>src/lib/a.js",
      `src/main.js>${deep.slice("repo-main/".length)}`,
    ]);
    expect(warnings).toEqual(["1 relative import pointed at files that aren't here: src/lib/a.js → ./missing."]);
  });

  it("titles the graph by its top folder when there's no package name", () => {
    const { graph } = analyseProject({ name: "x.zip", files: [{ path: "proj-main/a.js", text: "" }] });
    expect(graph.label).toBe("proj-main");
    expect(analyseProject({ name: "x.tar.gz", files: [{ path: "a.js", text: "" }] }).graph.label).toBe("x");
  });

  it("explains an archive with no source files", () => {
    expect(() => analyseProject({ name: "docs.zip", files: [{ path: "docs/package.json", text: "{}" }] })).toThrow(/No JavaScript/);
  });
});

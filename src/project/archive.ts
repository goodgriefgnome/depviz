import { ImportError } from "../importers/types";
import { MAX_SOURCE_BYTES, type SourceFile } from "./files";

export interface ReadResult {
  files: SourceFile[];
  /** Paths of wanted files that were too big to read. */
  tooLarge: string[];
}

export type ArchiveKind = "zip" | "gzip" | "tar";

/** Recognises a zip, gzip or tar file from its first bytes. */
export function archiveKind(bytes: Uint8Array): ArchiveKind | null {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6)) return "zip";
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes.length >= 512 && ascii(bytes, 257, 5) === "ustar") return "tar";
  return null;
}

/** Reads the files in a zip, tar or .tar.gz whose path passes `keep`. */
export async function readArchive(bytes: Uint8Array, keep: (path: string) => boolean): Promise<ReadResult> {
  switch (archiveKind(bytes)) {
    case "zip":
      return readZip(bytes, keep);
    case "gzip": {
      let tar: Uint8Array;
      try {
        tar = await inflate(bytes, "gzip");
      } catch {
        throw new ImportError("This .gz file is damaged or incomplete.");
      }
      if (archiveKind(tar) !== "tar") throw new ImportError("This .gz file doesn't contain a tar archive.");
      return readTar(tar, keep);
    }
    case "tar":
      return readTar(bytes, keep);
    default:
      throw new ImportError("This isn't a zip, tar or .tar.gz file.");
  }
}

const decoder = new TextDecoder("utf-8");
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

async function inflate(data: Uint8Array, format: "gzip" | "deflate-raw"): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ----- zip -----

interface ZipEntry {
  path: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

async function readZip(bytes: Uint8Array, keep: (path: string) => boolean): Promise<ReadResult> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => v.getUint16(at, true);
  const u32 = (at: number) => v.getUint32(at, true);
  const u64 = (at: number) => Number(v.getBigUint64(at, true));

  // End of central directory: the last record, followed by a comment of up to 64 KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportError("This zip file is damaged or incomplete.");
  let count = u16(eocd + 10);
  let cd = u32(eocd + 16);
  if ((count === 0xffff || cd === 0xffffffff) && eocd >= 20 && u32(eocd - 20) === 0x07064b50) {
    const z64 = u64(eocd - 12);
    if (u32(z64) !== 0x06064b50) throw new ImportError("This zip file is damaged or incomplete.");
    count = u64(z64 + 32);
    cd = u64(z64 + 48);
  }

  const entries: ZipEntry[] = [];
  let p = cd;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(p) !== 0x02014b50) throw new ImportError("This zip file is damaged or incomplete.");
    const flags = u16(p + 8);
    const method = u16(p + 10);
    let compressed = u32(p + 20);
    let size = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    let offset = u32(p + 42);
    const path = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // Zip64 sizes and offsets live in extra field 0x0001, in this order, only where the main field is maxed out.
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen; ) {
      const id = u16(e);
      const len = u16(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = u64(q);
          q += 8;
        }
        if (compressed === 0xffffffff) {
          compressed = u64(q);
          q += 8;
        }
        if (offset === 0xffffffff) offset = u64(q);
      }
      e += 4 + len;
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/") || flags & 1 || !keep(path)) continue; // folder, encrypted, or not wanted
    entries.push({ path, method, compressed, size, offset });
  }

  const files: SourceFile[] = [];
  const tooLarge: string[] = [];
  const read = async (e: ZipEntry) => {
    if (e.size > MAX_SOURCE_BYTES) return void tooLarge.push(e.path);
    if (u32(e.offset) !== 0x04034b50) return;
    const start = e.offset + 30 + u16(e.offset + 26) + u16(e.offset + 28);
    const raw = bytes.subarray(start, start + e.compressed);
    let data: Uint8Array;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = await inflate(raw, "deflate-raw");
    else return; // other compression methods are rare; skip
    files.push({ path: e.path, text: decoder.decode(data) });
  };
  // Inflate in batches: one stream per file, but not thousands at once.
  for (let i = 0; i < entries.length; i += 64) {
    await Promise.all(
      entries.slice(i, i + 64).map((e) =>
        read(e).catch(() => {
          throw new ImportError(`This zip file is damaged: couldn't unpack "${e.path}".`);
        }),
      ),
    );
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, tooLarge };
}

// ----- tar -----

function readTar(bytes: Uint8Array, keep: (path: string) => boolean): ReadResult {
  const files: SourceFile[] = [];
  const tooLarge: string[] = [];
  const field = (at: number, len: number) => {
    const b = bytes.subarray(at, at + len);
    const end = b.indexOf(0);
    return decoder.decode(end < 0 ? b : b.subarray(0, end));
  };
  const number = (at: number, len: number) => {
    if (bytes[at]! & 0x80) {
      // Base-256, used for sizes over 8 GB.
      let n = 0;
      for (let i = at + 1; i < at + len; i++) n = n * 256 + bytes[i]!;
      return n;
    }
    return parseInt(field(at, len).trim() || "0", 8);
  };

  let longName: string | undefined;
  let p = 0;
  while (p + 512 <= bytes.length) {
    if (bytes.subarray(p, p + 512).every((b) => b === 0)) break; // end of archive
    const type = String.fromCharCode(bytes[p + 156]!);
    const size = number(p + 124, 12);
    let name = field(p, 100);
    if (ascii(bytes, p + 257, 5) === "ustar") {
      const prefix = field(p + 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const data = p + 512;
    const body = () => bytes.subarray(data, data + size);
    p = data + Math.ceil(size / 512) * 512;

    if (type === "x") {
      // pax extended header: "<len> key=value\n" records that apply to the next file.
      const text = decoder.decode(body());
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
      if (m) longName = m[1];
      continue;
    }
    if (type === "L") {
      longName = field(data, size);
      continue;
    }
    if (type === "g") continue; // global pax header (GitHub puts the commit id here)
    if (longName !== undefined) {
      name = longName;
      longName = undefined;
    }
    if ((type !== "0" && type !== "\0" && type !== "7") || !keep(name)) continue;
    if (size > MAX_SOURCE_BYTES) {
      tooLarge.push(name);
      continue;
    }
    files.push({ path: name, text: decoder.decode(body()) });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, tooLarge };
}

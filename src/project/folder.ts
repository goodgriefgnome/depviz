import { isSkippedDir, MAX_SOURCE_BYTES, wanted, type SourceFile } from "./files";
import type { ReadResult } from "./archive";

/** Reads the wanted files from an `<input type=file webkitdirectory>` selection. */
export async function readFileList(list: Iterable<File>): Promise<ReadResult> {
  const picked: [string, File][] = [];
  for (const f of list) {
    const path = f.webkitRelativePath || f.name;
    if (wanted(path)) picked.push([path, f]);
  }
  return readAll(picked);
}

/** Reads the wanted files under a dropped folder, without walking into skipped folders like node_modules. */
export async function readDroppedFolder(dir: FileSystemDirectoryEntry): Promise<ReadResult> {
  const picked: [string, File][] = [];
  const walk = async (d: FileSystemDirectoryEntry, prefix: string): Promise<void> => {
    const reader = d.createReader();
    const entries: FileSystemEntry[] = [];
    // readEntries returns results in batches; keep asking until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      entries.push(...batch);
    }
    for (const e of entries) {
      const path = `${prefix}${e.name}`;
      if (e.isDirectory) {
        if (!isSkippedDir(e.name)) await walk(e as FileSystemDirectoryEntry, `${path}/`);
      } else if (wanted(path)) {
        picked.push([path, await new Promise<File>((resolve, reject) => (e as FileSystemFileEntry).file(resolve, reject))]);
      }
    }
  };
  await walk(dir, `${dir.name}/`);
  return readAll(picked);
}

async function readAll(picked: [string, File][]): Promise<ReadResult> {
  const files: SourceFile[] = [];
  const tooLarge: string[] = [];
  await Promise.all(
    picked.map(async ([path, f]) => {
      if (f.size > MAX_SOURCE_BYTES) tooLarge.push(path);
      else files.push({ path, text: await f.text() });
    }),
  );
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, tooLarge };
}

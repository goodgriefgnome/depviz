import { ImportError } from "../importers/types";
import { archiveKind, readArchive, wanted, type ProjectInput } from "../project";
import type { ReadResult } from "../project/archive";
import { readDroppedFolder, readFileList } from "../project/folder";
import { h } from "./dom";

export interface LoaderHandlers {
  /** Called with the text of a DOT file or paste. Returns an error message, or null on success. */
  load(text: string, name: string): string | null;
  /** Called with the files read from an archive or folder. Returns an error message, or null on success. */
  loadProject(project: ProjectInput): string | null;
  loadSample(): void;
  close(): void;
}

/** The screen for opening a graph: drop or choose a file or folder, or paste DOT. */
export class Loader {
  readonly el: HTMLElement;
  private readonly error: HTMLElement;
  private readonly status: HTMLElement;
  /** Increases with each read so a slow earlier read can't overwrite a later one. */
  private readSeq = 0;
  private readonly text: HTMLTextAreaElement;
  private readonly closeBtn: HTMLButtonElement;

  constructor(private readonly handlers: LoaderHandlers) {
    const fileInput = h("input", {
      type: "file",
      id: "file",
      accept: ".dot,.gv,.zip,.tar,.tgz,.gz,text/vnd.graphviz,text/plain,application/zip,application/gzip,application/x-tar",
      class: "visually-hidden",
    });
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) void this.readFile(f);
      fileInput.value = "";
    });
    const folderInput = h("input", { type: "file", id: "folder", webkitdirectory: true, class: "visually-hidden" });
    folderInput.addEventListener("change", () => {
      const list = [...(folderInput.files ?? [])];
      folderInput.value = "";
      const name = list[0]?.webkitRelativePath.split("/")[0] ?? "folder";
      if (list.length) void this.readProject(name, () => readFileList(list));
    });
    this.text = h("textarea", {
      id: "paste",
      rows: "8",
      spellcheck: "false",
      placeholder: 'digraph {\n  "src/main.js" -> "src/lib/api.js";\n}',
      "aria-label": "DOT text",
    });
    this.error = h("p", { class: "load-error", role: "alert", hidden: true });
    this.status = h("p", { class: "load-status", role: "status", hidden: true });
    this.closeBtn = h("button", { class: "btn quiet close", type: "button", onclick: () => handlers.close() }, "Back to graph");

    this.el = h(
      "section",
      { class: "loader", "aria-labelledby": "loader-title" },
      h(
        "div",
        { class: "loader-card" },
        h("div", { class: "loader-head" }, h("h2", { id: "loader-title" }, "Open a dependency graph"), this.closeBtn),
        h(
          "p",
          { class: "lede" },
          "Drop a project folder, a zip or tarball of one, or a Graphviz DOT file anywhere on this page. JavaScript and TypeScript imports are read in your browser; nothing is uploaded.",
        ),
        h(
          "div",
          { class: "loader-actions" },
          h("label", { class: "btn primary", for: "file" }, "Choose a file"),
          fileInput,
          h("label", { class: "btn", for: "folder" }, "Choose a folder"),
          folderInput,
          h("button", { class: "btn", type: "button", onclick: () => handlers.loadSample() }, "Try a sample"),
        ),
        this.status,
        h(
          "p",
          { class: "hint" },
          "From GitHub: on the repository page, choose ",
          h("strong", {}, "Code → Download ZIP"),
          ", then drop the zip here.",
        ),
        h("label", { class: "field-label", for: "paste" }, "Or paste DOT"),
        this.text,
        h(
          "div",
          { class: "loader-actions" },
          h("button", { class: "btn", type: "button", onclick: () => this.submitPaste() }, "Show graph"),
        ),
        this.error,
        h(
          "details",
          { class: "howto" },
          h("summary", {}, "What gets read, and how do I make a DOT file?"),
          h(
            "p",
            {},
            "From a folder or archive, each ",
            h("code", {}, ".js .jsx .ts .tsx .mjs .cjs"),
            " file becomes a module, and each ",
            h("code", {}, "import"),
            ", ",
            h("code", {}, "export … from"),
            ", ",
            h("code", {}, "import()"),
            " or ",
            h("code", {}, "require()"),
            " of another file in the project becomes an arrow. Imports of packages are left out. Relative paths, ",
            h("code", {}, "index"),
            " files, tsconfig ",
            h("code", {}, "paths"),
            " and workspace packages are followed; aliases set only in a bundler config are not. ",
            h("code", {}, "node_modules"),
            ", build output and test files are skipped (tests can be shown afterwards).",
          ),
          h("p", {}, "For other languages, most dependency tools can write DOT. For example:"),
          h(
            "ul",
            {},
            h("li", {}, h("code", {}, "npx depcruise --no-config -T dot src > deps.dot"), " (JavaScript, TypeScript)"),
            h("li", {}, h("code", {}, "npx madge --dot src/main.js > deps.dot"), " (JavaScript; needs Graphviz)"),
            h("li", {}, h("code", {}, "pydeps mypackage --show-dot --no-output > deps.dot"), " (Python)"),
            h("li", {}, h("code", {}, "cargo depgraph > deps.dot"), " (Rust)"),
          ),
          h("p", {}, "Node ids that look like paths (", h("code", {}, "src/lib/api.js"), ") are grouped into folders automatically. ", h("code", {}, "subgraph cluster_…"), " blocks become folders too."),
        ),
      ),
    );
    this.text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) this.submitPaste();
    });
  }

  /** Accept files dropped anywhere on `target`. */
  attachDropTarget(target: HTMLElement): void {
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    target.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      target.classList.add("dragging");
    });
    target.addEventListener("dragleave", (e) => {
      if (e.relatedTarget === null || !target.contains(e.relatedTarget as Node)) target.classList.remove("dragging");
    });
    target.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      target.classList.remove("dragging");
      // Entries must be taken during the drop event; they are gone once it returns.
      const entry = e.dataTransfer?.items[0]?.webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        const dir = entry as FileSystemDirectoryEntry;
        void this.readProject(dir.name, () => readDroppedFolder(dir));
        return;
      }
      const f = e.dataTransfer?.files[0];
      if (f) void this.readFile(f);
    });
  }

  show(canClose: boolean): void {
    this.el.hidden = false;
    this.closeBtn.hidden = !canClose;
  }

  hide(): void {
    this.el.hidden = true;
    this.setError(null);
    this.setStatus(null);
  }

  private async readFile(f: File): Promise<void> {
    const seq = ++this.readSeq;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await f.arrayBuffer());
    } catch {
      return this.fail(seq, `Couldn't read "${f.name}".`);
    }
    if (seq !== this.readSeq) return;
    if (archiveKind(bytes)) return this.readProject(f.name, () => readArchive(bytes, wanted), seq);
    this.finish(this.handlers.load(new TextDecoder().decode(bytes), f.name));
  }

  /** Reads a folder or archive, showing progress, then hands the files over. */
  private async readProject(name: string, read: () => Promise<ReadResult>, seq = ++this.readSeq): Promise<void> {
    this.setError(null);
    this.setStatus(`Reading ${name}…`);
    this.el.hidden = false;
    let result: ReadResult;
    try {
      result = await read();
    } catch (err) {
      return this.fail(seq, err instanceof ImportError ? err.message : `Couldn't read "${name}".`);
    }
    if (seq !== this.readSeq) return;
    this.setStatus(`Finding imports in ${result.files.length.toLocaleString()} files…`);
    // Let the status paint before the (synchronous) analysis starts.
    await new Promise((r) => setTimeout(r, 0));
    if (seq !== this.readSeq) return;
    this.setStatus(null);
    this.finish(this.handlers.loadProject({ name, files: result.files, tooLarge: result.tooLarge }));
  }

  private fail(seq: number, message: string): void {
    if (seq !== this.readSeq) return;
    this.setStatus(null);
    this.setError(message);
    this.el.hidden = false;
  }

  private setStatus(message: string | null): void {
    this.status.textContent = message ?? "";
    this.status.hidden = !message;
  }

  private submitPaste(): void {
    this.readSeq++;
    const text = this.text.value;
    if (!text.trim()) return this.setError("Paste some DOT first.");
    this.finish(this.handlers.load(text, "Pasted graph"));
  }

  private finish(error: string | null): void {
    this.setError(error);
    if (error) this.el.hidden = false;
  }

  setError(message: string | null): void {
    this.error.textContent = message ?? "";
    this.error.hidden = !message;
  }
}

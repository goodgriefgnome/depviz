import { h } from "./dom";

export interface LoaderHandlers {
  /** Called with the text of a file or paste. Returns an error message, or null on success. */
  load(text: string, name: string): string | null;
  loadSample(): void;
  close(): void;
}

/** The screen for opening a graph: drop or choose a file, or paste DOT. */
export class Loader {
  readonly el: HTMLElement;
  private readonly error: HTMLElement;
  private readonly text: HTMLTextAreaElement;
  private readonly closeBtn: HTMLButtonElement;

  constructor(private readonly handlers: LoaderHandlers) {
    const fileInput = h("input", { type: "file", id: "file", accept: ".dot,.gv,text/vnd.graphviz,text/plain", class: "visually-hidden" });
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) void this.readFile(f);
      fileInput.value = "";
    });
    this.text = h("textarea", {
      id: "paste",
      rows: "8",
      spellcheck: "false",
      placeholder: 'digraph {\n  "src/main.js" -> "src/lib/api.js";\n}',
      "aria-label": "DOT text",
    });
    this.error = h("p", { class: "load-error", role: "alert", hidden: true });
    this.closeBtn = h("button", { class: "btn quiet close", type: "button", onclick: () => handlers.close() }, "Back to graph");

    this.el = h(
      "section",
      { class: "loader", "aria-labelledby": "loader-title" },
      h(
        "div",
        { class: "loader-card" },
        h("div", { class: "loader-head" }, h("h2", { id: "loader-title" }, "Open a dependency graph"), this.closeBtn),
        h("p", { class: "lede" }, "Drop a Graphviz DOT file anywhere on this page, or choose one. Nothing is uploaded; the file is read in your browser."),
        h(
          "div",
          { class: "loader-actions" },
          h("label", { class: "btn primary", for: "file" }, "Choose a .dot file"),
          fileInput,
          h("button", { class: "btn", type: "button", onclick: () => handlers.loadSample() }, "Try a sample"),
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
          h("summary", {}, "How do I get a DOT file for my project?"),
          h("p", {}, "Most dependency tools can write one. For example:"),
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
  }

  private async readFile(f: File): Promise<void> {
    try {
      this.finish(this.handlers.load(await f.text(), f.name));
    } catch {
      this.setError(`Couldn't read "${f.name}".`);
      this.el.hidden = false;
    }
  }

  private submitPaste(): void {
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

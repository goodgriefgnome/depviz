/**
 * Finds the module specifiers a JavaScript or TypeScript file imports:
 * `import … from "x"`, `import "x"`, `export … from "x"`, `import("x")` and `require("x")`.
 *
 * This is a tokenizer, not a parser. It skips comments, strings, template literals and
 * regular expressions so that import-like text inside them is ignored, and it is forgiving:
 * JSX text or unusual syntax can confuse it for the rest of a line, never the whole file.
 */
export function findImports(code: string): string[] {
  const toks = tokenize(code);
  const found: string[] = [];
  const at = (i: number) => toks[i];
  const isPunc = (i: number, c: string) => at(i)?.t === "p" && at(i)!.v === c;
  const isId = (i: number, v: string) => at(i)?.t === "id" && at(i)!.v === v;
  const str = (i: number) => (at(i)?.t === "s" ? at(i)!.v : undefined);

  /** From `j`, skips names, commas, braces and `*` up to `from "x"`. */
  const fromClause = (j: number): string | undefined => {
    for (const end = j + 2000; j < end && j < toks.length; j++) {
      const tk = toks[j]!;
      if (tk.t === "id") {
        if (tk.v === "from" && str(j + 1) !== undefined) return str(j + 1);
      } else if (!(tk.t === "p" && (tk.v === "{" || tk.v === "}" || tk.v === "," || tk.v === "*"))) return undefined;
    }
    return undefined;
  };

  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i]!;
    if (tk.t !== "id" || isPunc(i - 1, ".")) continue;
    let spec: string | undefined;
    if (tk.v === "import") {
      if (isPunc(i + 1, "(")) spec = str(i + 2);
      else if (isPunc(i + 1, ".")) continue; // import.meta
      else spec = str(i + 1) ?? fromClause(i + 1);
    } else if (tk.v === "export") {
      let j = i + 1;
      if (isId(j, "type")) j++;
      if (isPunc(j, "*") || isPunc(j, "{")) spec = fromClause(j);
    } else if (tk.v === "require") {
      if (isPunc(i + 1, "(") && isPunc(i + 3, ")")) spec = str(i + 2);
    }
    if (spec !== undefined) found.push(spec);
  }
  return found;
}

interface Token {
  /** identifier, string, punctuation, or other value (number, regex, template) */
  t: "id" | "s" | "p" | "v";
  v: string;
}

/** Words after which a `/` starts a regular expression rather than dividing. */
const BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

function tokenize(code: string): Token[] {
  const toks: Token[] = [];
  const n = code.length;
  /** For each open `{`: true if it opened a template `${`. */
  const braces: boolean[] = [];
  let i = 0;
  if (code.startsWith("#!")) i = lineEnd(code, 0);

  const regexAllowed = () => {
    const prev = toks[toks.length - 1];
    if (!prev) return true;
    if (prev.t === "p") return prev.v !== ")" && prev.v !== "]";
    if (prev.t === "id") return BEFORE_REGEX.has(prev.v);
    return false;
  };

  /** Reads template text from `i` (just after ` or }) up to the closing ` or a `${`. */
  const template = () => {
    while (i < n) {
      const c = code[i]!;
      if (c === "\\") i += 2;
      else if (c === "`") {
        i++;
        toks.push({ t: "v", v: "`" });
        return;
      } else if (c === "$" && code[i + 1] === "{") {
        i += 2;
        braces.push(true);
        toks.push({ t: "p", v: "${" });
        return;
      } else i++;
    }
  };

  while (i < n) {
    const c = code[i]!;
    const cc = code.charCodeAt(i);
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || cc === 0xfeff || cc === 0xa0 || cc === 0x2028 || cc === 0x2029) {
      i++;
    } else if (c === "/" && code[i + 1] === "/") {
      i = lineEnd(code, i);
    } else if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === "'" || c === '"') {
      // Strings can't contain raw newlines, so an unclosed quote (say, an apostrophe in JSX text) ends at the line.
      let v = "";
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = code[j]!;
        if (d === c) {
          closed = true;
          j++;
          break;
        }
        if (d === "\n") break;
        if (d === "\\") {
          const e = code[j + 1];
          v += e === "n" ? "\n" : e === "t" ? "\t" : e === "\r" || e === "\n" ? "" : (e ?? "");
          j += 2;
        } else {
          v += d;
          j++;
        }
      }
      i = j;
      toks.push(closed ? { t: "s", v } : { t: "v", v: "" });
    } else if (c === "`") {
      i++;
      template();
    } else if (/[A-Za-z_$#]/.test(c) || cc > 0x7f) {
      let j = i + 1;
      while (j < n && (/[\w$]/.test(code[j]!) || code.charCodeAt(j) > 0x7f)) j++;
      toks.push({ t: "id", v: code.slice(i, j) });
      i = j;
    } else if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && /[\w.]/.test(code[j]!)) j++;
      toks.push({ t: "v", v: code.slice(i, j) });
      i = j;
    } else if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && code[j] !== "\n") {
        const d = code[j]!;
        if (d === "\\") j++;
        else if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /\w/.test(code[j]!)) j++;
      toks.push({ t: "v", v: "/re/" });
      i = j;
    } else if (c === "{") {
      braces.push(false);
      toks.push({ t: "p", v: c });
      i++;
    } else if (c === "}") {
      i++;
      if (braces.pop()) template();
      else toks.push({ t: "p", v: c });
    } else {
      toks.push({ t: "p", v: c });
      i++;
    }
  }
  return toks;
}

function lineEnd(code: string, from: number): number {
  const nl = code.indexOf("\n", from);
  return nl < 0 ? code.length : nl;
}

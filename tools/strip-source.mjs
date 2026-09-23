/**
 * Removes comments and string/template/regex literals from JavaScript or CSS
 * source, preserving line structure so reported line numbers stay accurate.
 *
 * The guards scan for forbidden *syntax*. Without this step a banned token
 * mentioned inside a comment or a string — including the comments in the guards'
 * own documentation — would trip the build, and a guard that cries wolf gets
 * disabled, which is worse than no guard at all.
 */
export function stripLiterals(source) {
  let out = "";
  let i = 0;
  const n = source.length;

  // Tracks whether a `/` starts a regex or is a division operator.
  let prevSignificant = "";

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : "";
        i += 1;
      }
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") i += 1;
        else if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 1;
      out += '""';
      prevSignificant = '"';
      continue;
    }

    if (ch === "/" && /[(,=:[!&|?{};+\-*%~^]/.test(prevSignificant)) {
      i += 1;
      while (i < n && source[i] !== "/" && source[i] !== "\n") {
        if (source[i] === "\\") i += 1;
        if (source[i] === "[") {
          while (i < n && source[i] !== "]") i += 1;
        }
        i += 1;
      }
      i += 1;
      out += "/re/";
      prevSignificant = "/";
      continue;
    }

    out += ch;
    if (!/\s/.test(ch)) prevSignificant = ch;
    i += 1;
  }

  return out;
}

/** Returns 1-based line numbers where `pattern` matches `source`. */
export function findLines(source, pattern) {
  const lines = source.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const re = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    if (re.test(lines[i])) hits.push(i + 1);
  }
  return hits;
}

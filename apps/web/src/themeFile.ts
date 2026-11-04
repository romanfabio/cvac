/**
 * Read and change the top-level `extends:` of a theme.yaml as text, so the
 * theme picker edits the file the user sees (keeping comments, layout and
 * undo history) instead of regenerating it.
 */

/** `extends: value  # comment` at column 0. */
const EXTENDS = /^extends:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#][^\n#]*?))?[ \t]*(#[^\n]*)?$/m;

/** The theme's base as written (a built-in name or a file path), if any. */
export function readExtends(text: string): string | undefined {
  const m = EXTENDS.exec(text);
  if (!m) return undefined;
  const value = m[1] ?? m[2] ?? m[3];
  return value?.trim() || undefined;
}

/** Point `extends:` at `name`, adding the line if the theme has none. */
export function setExtends(text: string, name: string): string {
  const m = EXTENDS.exec(text);
  if (m) {
    const comment = m[4] ? `  ${m[4]}` : "";
    return (
      text.slice(0, m.index) + `extends: ${name}${comment}` + text.slice(m.index + m[0].length)
    );
  }
  const line = `extends: ${name}\n`;
  // After a top-level `version:` line, else after the leading comments.
  const version = /^version:[^\n]*\n?/m.exec(text);
  if (version) {
    const at = version.index + version[0].length;
    const sep = version[0].endsWith("\n") ? "" : "\n";
    return text.slice(0, at) + sep + line + text.slice(at);
  }
  const lead = /^(?:#[^\n]*\n|[ \t]*\n)*/.exec(text)?.[0] ?? "";
  return lead + line + text.slice(lead.length);
}

import type { Block, LayoutDocument, Paragraph, Run } from "../../layout/ir.ts";

/**
 * Markdown and plain-text renderers. Both read the linear layout (one column
 * in CV order, like the DOCX), so they carry the same text, labels, dates
 * and heading case as the other formats, in the same reading order. The
 * output is a pure function of the layout: no wrapping, `\n` line endings,
 * one trailing newline.
 */

/** Paragraph text as one line (a CV text never needs a hard break). */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ");

const blocksOf = (doc: LayoutDocument): (Paragraph | Paragraph[])[] =>
  doc.blocks.map((b: Block) => (b.kind === "group" ? b.blocks : b));

const finish = (chunks: string[]) => `${chunks.filter(Boolean).join("\n\n")}\n`;

// --- Markdown -------------------------------------------------------------

/** Escape characters that would start Markdown (CommonMark + GFM) syntax. */
function mdEscape(s: string): string {
  return oneLine(s)
    .replace(/[\\`*_[\]<>~]/g, "\\$&")
    .replace(/&(?=#?\w+;)/g, "&amp;");
}

/** Escape what would make a line a heading, quote, list or rule. */
function mdLineStart(line: string): string {
  return line.replace(/^([#>+\-=|])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");
}

function mdUrl(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
}

/** Bold and italic markers go around the text, never around its edge spaces. */
function mdRun(r: Run, styled: boolean): string {
  const text = mdEscape(r.text);
  const [, lead = "", core = "", trail = ""] = /^(\s*)(.*?)(\s*)$/s.exec(text) ?? [];
  if (!core) return text;
  let out = core;
  if (styled && !r.separator) {
    if (r.style.italic) out = `*${out}*`;
    if (r.style.weight >= 600) out = `**${out}**`;
  }
  if (r.link) out = `[${out}](${mdUrl(r.link)})`;
  return lead + out + trail;
}

const mdRuns = (runs: Run[], styled = true) => runs.map((r) => mdRun(r, styled)).join("");

/** Render a layout as Markdown (CommonMark, with GFM-safe escaping). */
export function renderMarkdown(doc: LayoutDocument): string {
  const chunks: string[] = [];
  for (const b of blocksOf(doc)) {
    if (!Array.isArray(b)) {
      chunks.push(mdBlock(b));
      continue;
    }
    // One CV entry: title, then its dates and subtitles as one paragraph of
    // lines, then text and a list of highlights.
    let meta: string[] = [];
    let bullets: string[] = [];
    const flush = () => {
      if (meta.length) chunks.push(meta.map(mdLineStart).join("\\\n"));
      if (bullets.length) chunks.push(bullets.join("\n"));
      meta = [];
      bullets = [];
    };
    for (const p of b) {
      if (p.role === "item-title") {
        flush();
        chunks.push(mdHeading(3, p));
        if (p.aside?.length) meta.push(mdRuns(p.aside));
      } else if (p.role === "item-subtitle") {
        if (bullets.length) flush();
        meta.push(mdRuns(p.runs));
      } else if (p.role === "bullet") {
        if (meta.length) {
          chunks.push(meta.map(mdLineStart).join("\\\n"));
          meta = [];
        }
        bullets.push(`- ${mdLineStart(mdRuns(p.runs))}`);
      } else {
        flush();
        chunks.push(mdBlock(p));
      }
    }
    flush();
  }
  return finish(chunks);
}

/** An ATX heading; a trailing ` #` would otherwise read as its closing sequence. */
const mdHeading = (level: number, p: Paragraph) =>
  `${"#".repeat(level)} ${mdRuns(p.runs, false).replace(/(\s)#+$/, (m) => m.replace(/#/g, "\\#"))}`;

function mdBlock(p: Paragraph): string {
  switch (p.role) {
    case "name":
      return mdHeading(1, p);
    case "heading":
      return mdHeading(2, p);
    case "item-title":
      return mdHeading(3, p);
    case "bullet":
      return `- ${mdLineStart(mdRuns(p.runs))}`;
    default:
      return mdLineStart(mdRuns([...p.runs, ...(p.aside ?? [])]));
  }
}

// --- Plain text -------------------------------------------------------------

/** Run text, plus the address of a link whose text does not already show it. */
function txtRun(r: Run): string {
  const text = oneLine(r.text);
  const link = r.link;
  if (!link || /^(mailto|tel):/i.test(link)) return text;
  const bare = (s: string) => s.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return bare(link) === bare(text.trim()) ? text : `${text} (${link})`;
}

const txtRuns = (runs: Run[]) => runs.map(txtRun).join("");

/** Render a layout as plain text: headings underlined, highlights as `- ` lines. */
export function renderText(doc: LayoutDocument): string {
  const chunks: string[] = [];
  let header: string[] = [];
  for (const b of blocksOf(doc)) {
    if (!Array.isArray(b) && (b.role === "name" || b.role === "headline" || b.role === "contact")) {
      header.push(txtRuns(b.runs));
      continue;
    }
    if (header.length) {
      chunks.push(header.join("\n"));
      header = [];
    }
    if (Array.isArray(b)) {
      // One CV entry, as a block of lines.
      chunks.push(
        b
          .flatMap((p) => {
            const line = txtRuns(p.runs);
            if (p.role === "bullet") return [`- ${line}`];
            return p.aside?.length ? [line, txtRuns(p.aside)] : [line];
          })
          .join("\n"),
      );
    } else if (b.role === "heading") {
      const text = txtRuns(b.runs);
      chunks.push(`${text}\n${"-".repeat([...text].length)}`);
    } else {
      chunks.push(b.role === "bullet" ? `- ${txtRuns(b.runs)}` : txtRuns(b.runs));
    }
  }
  if (header.length) chunks.push(header.join("\n"));
  return finish(chunks);
}

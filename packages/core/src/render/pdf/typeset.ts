/// <reference path="./linebreak.d.ts" />
import { LineBreaker } from "linebreak";
import type {
  Block,
  BlockRole,
  LayoutDocument,
  Paragraph,
  Run,
  TextStyle,
} from "../../layout/ir.ts";

/** Text metrics provider (pdfkit in production, a fake in tests). */
export interface Measurer {
  width(text: string, style: TextStyle): number;
  /** Font ascender above the baseline, in points. */
  ascent(style: TextStyle): number;
  /** Font descender below the baseline, in points (positive). */
  descent(style: TextStyle): number;
}

export interface TextItem {
  type: "text";
  x: number;
  /** Baseline. */
  y: number;
  text: string;
  style: TextStyle;
  link?: string;
  role: BlockRole;
}

export interface RuleItem {
  type: "rule";
  x1: number;
  x2: number;
  y: number;
  color: string;
  thickness: number;
}

export type DrawItem = TextItem | RuleItem;

export interface TypesetPage {
  items: DrawItem[];
}

const ASIDE_GAP = 8;
const BULLET_GAP = 4;
/** Minimum lines kept together at the start/end of a split paragraph. */
const ORPHANS = 2;
const EPS = 0.001;

interface Piece {
  text: string;
  style: TextStyle;
  link?: string;
  width: number;
}

/** A break-free unit (word + trailing space), possibly spanning styles. */
interface Unit {
  pieces: Piece[];
  width: number;
  /** Width of trailing whitespace, dropped at the end of a line. */
  trailing: number;
  required: boolean;
}

interface Line {
  pieces: Piece[];
  height: number;
  ascent: number;
  descent: number;
}

interface SetParagraph {
  p: Paragraph;
  lines: Line[];
  asideWidth: number;
}

/** Turn a layout document into positioned pages. Pure and deterministic. */
export function typeset(doc: LayoutDocument, m: Measurer): TypesetPage[] {
  return new Typesetter(doc, m).run();
}

class Typesetter {
  private pages: TypesetPage[] = [];
  private page!: TypesetPage;
  private y = 0;
  private readonly left: number;
  private readonly right: number;
  private readonly top: number;
  private readonly bottom: number;

  private readonly doc: LayoutDocument;
  private readonly m: Measurer;

  constructor(doc: LayoutDocument, m: Measurer) {
    this.doc = doc;
    this.m = m;
    const { width, height, margins } = doc.page;
    this.left = margins.left;
    this.right = width - margins.right;
    this.top = margins.top;
    this.bottom = height - margins.bottom;
  }

  run(): TypesetPage[] {
    this.newPage();
    const flat = this.doc.blocks;
    for (let i = 0; i < flat.length; i++) this.placeBlock(flat[i] as Block, flat[i + 1]);
    return this.pages;
  }

  private newPage() {
    this.page = { items: [] };
    this.pages.push(this.page);
    this.y = this.top;
  }

  private get atTop() {
    return Math.abs(this.y - this.top) < EPS;
  }
  private get remaining() {
    return this.bottom - this.y;
  }
  private get pageHeight() {
    return this.bottom - this.top;
  }

  // ---- measuring ---------------------------------------------------------

  private cache = new Map<Paragraph, SetParagraph>();

  private set(p: Paragraph): SetParagraph {
    let s = this.cache.get(p);
    if (!s) {
      const asideWidth = p.aside ? sum(p.aside.map((r) => this.m.width(r.text, r.style))) : 0;
      const width = this.right - this.left - p.indent;
      const firstWidth = width - (asideWidth ? asideWidth + ASIDE_GAP : 0);
      s = { p, lines: this.breakLines(p, firstWidth, width), asideWidth };
      this.cache.set(p, s);
    }
    return s;
  }

  private spaceBefore(p: Paragraph, atTop: boolean) {
    return atTop ? 0 : p.spaceBefore;
  }

  private tail(p: Paragraph) {
    return p.spaceAfter + (p.ruleBelow ? p.ruleBelow.gap + p.ruleBelow.thickness : 0);
  }

  private height(p: Paragraph, atTop = false): number {
    return this.spaceBefore(p, atTop) + sum(this.set(p).lines.map((l) => l.height)) + this.tail(p);
  }

  private groupHeight(blocks: Paragraph[], atTop = false): number {
    return sum(blocks.map((b, i) => this.height(b, atTop && i === 0)));
  }

  /** Smallest amount of `b` that must fit for `b` to start on this page. */
  private minStart(b: Block | undefined, atTop: boolean): number {
    if (!b) return 0;
    if (b.kind === "group") {
      const h = this.groupHeight(b.blocks, atTop);
      if (b.keepTogether && h <= this.pageHeight) return h;
      return this.minStart(b.blocks[0], atTop);
    }
    const lines = this.set(b).lines;
    const n = lines.length <= ORPHANS * 2 ? lines.length : ORPHANS;
    const own = this.spaceBefore(b, atTop) + sum(lines.slice(0, n).map((l) => l.height));
    return n === lines.length ? own + this.tail(b) : own;
  }

  // ---- placing -------------------------------------------------------------

  private placeBlock(b: Block, next: Block | undefined) {
    if (b.kind === "paragraph") return this.placeParagraph(b, next);
    const h = this.groupHeight(b.blocks, this.atTop);
    if (b.keepTogether && h > this.remaining + EPS && h <= this.pageHeight && !this.atTop) {
      this.newPage();
    }
    b.blocks.forEach((child, i) => this.placeParagraph(child, b.blocks[i + 1] ?? next));
  }

  private placeParagraph(p: Paragraph, next: Block | undefined) {
    const s = this.set(p);
    let need = this.height(p, this.atTop);
    if (p.keepWithNext) need += this.minStart(next, false);

    if (need > this.remaining + EPS && !this.atTop) {
      // Split long paragraphs (not headings) keeping ORPHANS lines on each side.
      const splittable = !p.keepWithNext && s.lines.length >= ORPHANS * 2;
      const before = this.spaceBefore(p, false);
      let fit = 0;
      let h = before;
      if (splittable) {
        while (fit < s.lines.length && h + (s.lines[fit] as Line).height <= this.remaining + EPS) {
          h += (s.lines[fit] as Line).height;
          fit++;
        }
        fit = Math.min(fit, s.lines.length - ORPHANS);
      }
      if (fit >= ORPHANS) {
        this.y += before;
        this.drawLines(s, 0, fit);
        this.newPage();
        this.drawLines(s, fit, s.lines.length);
        this.finish(p);
        return;
      }
      this.newPage();
    }

    this.y += this.spaceBefore(p, this.atTop);
    // Content taller than a page: emit line by line, breaking as needed.
    for (let i = 0; i < s.lines.length; i++) {
      const line = s.lines[i] as Line;
      if (line.height > this.remaining + EPS && !this.atTop) this.newPage();
      this.drawLines(s, i, i + 1);
    }
    this.finish(p);
  }

  private finish(p: Paragraph) {
    if (p.ruleBelow) {
      const r = p.ruleBelow;
      this.y += r.gap;
      this.page.items.push({
        type: "rule",
        x1: this.left + p.indent,
        x2: this.right,
        y: this.y + r.thickness / 2,
        color: r.color,
        thickness: r.thickness,
      });
      this.y += r.thickness;
    }
    this.y += p.spaceAfter;
  }

  private drawLines(s: SetParagraph, from: number, to: number) {
    const { p } = s;
    for (let i = from; i < to; i++) {
      const line = s.lines[i] as Line;
      // Center the font box (ascent + descent) in the line box: CSS-like half-leading.
      const baseline = this.y + (line.height - line.ascent - line.descent) / 2 + line.ascent;
      let x = this.left + p.indent;

      if (i === 0 && p.bullet) {
        const st = p.runs[0]?.style;
        if (st) {
          const w = this.m.width(p.bullet, st);
          this.text(x - w - BULLET_GAP, baseline, p.bullet, st, p.role);
        }
      }
      for (const piece of line.pieces) {
        this.text(x, baseline, piece.text, piece.style, p.role, piece.link);
        x += piece.width;
      }
      if (i === 0 && p.aside) {
        let ax = this.right - s.asideWidth;
        for (const r of p.aside) {
          this.text(ax, baseline, r.text, r.style, p.role, r.link);
          ax += this.m.width(r.text, r.style);
        }
      }
      this.y += line.height;
    }
  }

  private text(
    x: number,
    y: number,
    text: string,
    style: TextStyle,
    role: BlockRole,
    link?: string,
  ) {
    if (!text) return;
    const item: TextItem = { type: "text", x, y, text, style, role };
    if (link) item.link = link;
    this.page.items.push(item);
  }

  // ---- line breaking -------------------------------------------------------

  private breakLines(p: Paragraph, firstWidth: number, width: number): Line[] {
    const units = this.units(p.runs, width);
    const lines: Piece[][] = [[]];
    let lineWidth = 0;
    let avail = firstWidth;

    for (const u of units) {
      const cur = lines[lines.length - 1] as Piece[];
      if (cur.length && lineWidth + u.width - u.trailing > avail + EPS) {
        lines.push([]);
        lineWidth = 0;
        avail = width;
      }
      (lines[lines.length - 1] as Piece[]).push(...u.pieces);
      lineWidth += u.width;
      if (u.required) {
        lines.push([]);
        lineWidth = 0;
        avail = width;
      }
    }
    if (lines.length > 1 && (lines[lines.length - 1] as Piece[]).length === 0) lines.pop();

    const fallback = p.runs[0]?.style;
    return lines.map((pieces) => this.finishLine(pieces, p, fallback));
  }

  private finishLine(pieces: Piece[], p: Paragraph, fallback: TextStyle | undefined): Line {
    const merged = mergePieces(trimEnd(pieces, this.m));
    const styles = [...merged.map((x) => x.style), ...(p.aside ?? []).map((r) => r.style)];
    if (!styles.length && fallback) styles.push(fallback);
    const size = Math.max(...styles.map((s) => s.size), 0);
    const ascent = Math.max(...styles.map((s) => this.m.ascent(s)), 0);
    const descent = Math.max(...styles.map((s) => this.m.descent(s)), 0);
    return { pieces: merged, height: size * p.lineHeight, ascent, descent };
  }

  /** Split runs into break-free units using UAX #14 over the joined text. */
  private units(runs: Run[], maxWidth: number): Unit[] {
    const text = runs.map((r) => r.text).join("");
    const bounds: { start: number; end: number; run: Run }[] = [];
    let off = 0;
    for (const r of runs) {
      bounds.push({ start: off, end: off + r.text.length, run: r });
      off += r.text.length;
    }

    const out: Unit[] = [];
    const breaker = new LineBreaker(text);
    let last = 0;
    for (let bk = breaker.nextBreak(); bk; bk = breaker.nextBreak()) {
      // ATS safety: never break after a hyphen. Text extractors treat a
      // line-final "-" as hyphenation and glue the halves ("event-driven"
      // -> "eventdriven", URLs and emails get corrupted).
      if (
        !bk.required &&
        bk.position < text.length &&
        /[-‐]$/.test(text.slice(last, bk.position))
      ) {
        continue;
      }
      const pieces: Piece[] = [];
      for (const b of bounds) {
        const s = Math.max(last, b.start);
        const e = Math.min(bk.position, b.end);
        if (s >= e) continue;
        const t = text.slice(s, e).replace(/\n/g, "");
        if (!t) continue;
        const piece: Piece = { text: t, style: b.run.style, width: this.m.width(t, b.run.style) };
        if (b.run.link) piece.link = b.run.link;
        pieces.push(piece);
      }
      last = bk.position;
      if (!pieces.length) continue;
      const lastPiece = pieces[pieces.length - 1] as Piece;
      const trimmed = lastPiece.text.replace(/\s+$/, "");
      const trailing = lastPiece.width - this.m.width(trimmed, lastPiece.style);
      const unit: Unit = {
        pieces,
        width: sum(pieces.map((x) => x.width)),
        trailing,
        required: bk.required,
      };
      out.push(...(unit.width - trailing > maxWidth ? this.hardSplit(unit, maxWidth) : [unit]));
    }
    return out;
  }

  /** Last resort for words wider than the line: break between characters. */
  private hardSplit(u: Unit, maxWidth: number): Unit[] {
    const out: Unit[] = [];
    let cur: Piece[] = [];
    let w = 0;
    for (const piece of u.pieces) {
      for (const ch of piece.text) {
        const cw = this.m.width(ch, piece.style);
        if (w + cw > maxWidth && w > 0) {
          out.push({ pieces: cur, width: w, trailing: 0, required: false });
          cur = [];
          w = 0;
        }
        const prev = cur[cur.length - 1];
        if (prev && prev.style === piece.style && prev.link === piece.link) {
          prev.text += ch;
          prev.width += cw;
        } else {
          const np: Piece = { text: ch, style: piece.style, width: cw };
          if (piece.link) np.link = piece.link;
          cur.push(np);
        }
        w += cw;
      }
    }
    if (cur.length) out.push({ pieces: cur, width: w, trailing: u.trailing, required: u.required });
    return out;
  }
}

function trimEnd(pieces: Piece[], m: Measurer): Piece[] {
  const out = pieces.slice();
  while (out.length) {
    const p = out[out.length - 1] as Piece;
    const t = p.text.replace(/\s+$/, "");
    if (t === p.text) break;
    if (t) {
      out[out.length - 1] = { ...p, text: t, width: m.width(t, p.style) };
      break;
    }
    out.pop();
  }
  return out;
}

/** Join consecutive pieces with the same style/link into one text item. */
function mergePieces(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (prev && sameStyle(prev.style, p.style) && prev.link === p.link) {
      out[out.length - 1] = { ...prev, text: prev.text + p.text, width: prev.width + p.width };
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

function sameStyle(a: TextStyle, b: TextStyle) {
  return (
    a === b ||
    (a.family === b.family &&
      a.weight === b.weight &&
      a.italic === b.italic &&
      a.size === b.size &&
      a.color === b.color)
  );
}

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}

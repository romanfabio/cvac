/**
 * Layout IR: a *flow-level* description of the document, shared by all
 * renderers. It says what text appears, in which (semantic, reading) order and
 * with which styles, but not where it lands on a page. The PDF renderer
 * breaks lines and paginates; the DOCX renderer maps blocks to native Word
 * paragraphs and lets Word paginate. Keep it plain data (serializable).
 */

export interface TextStyle {
  family: string;
  /** 100-900 */
  weight: number;
  italic: boolean;
  /** Points. */
  size: number;
  /** `#rrggbb` */
  color: string;
}

export interface Run {
  text: string;
  style: TextStyle;
  link?: string;
}

/** What a block *is*: renderers map roles to PDF structure tags / Word styles. */
export type BlockRole =
  | "name"
  | "headline"
  | "contact"
  | "heading"
  | "item-title"
  | "item-subtitle"
  | "body"
  | "bullet";

export interface Paragraph {
  kind: "paragraph";
  role: BlockRole;
  /** 1 = document title (name), 2 = section heading, 3 = item title. */
  headingLevel?: 1 | 2 | 3;
  runs: Run[];
  /** Right-aligned text on the first line (e.g. dates), read after `runs`. */
  aside?: Run[];
  /** Left indent in points (bullets hang inside the indent). */
  indent: number;
  bullet?: string;
  /** Points. */
  spaceBefore: number;
  spaceAfter: number;
  /** Line height as a multiple of the largest font size on the line. */
  lineHeight: number;
  keepWithNext?: boolean;
  /** Draw a rule under the paragraph (section headings). */
  ruleBelow?: { color: string; thickness: number; gap: number };
}

/** Blocks that should stay on one page if they fit (one CV entry). */
export interface Group {
  kind: "group";
  keepTogether: boolean;
  blocks: Paragraph[];
}

export type Block = Paragraph | Group;

export interface LayoutDocument {
  meta: {
    title: string;
    author: string;
    /** BCP 47, e.g. `en`. */
    lang: string;
    subject?: string;
    keywords?: string[];
  };
  page: {
    width: number;
    height: number;
    margins: { top: number; right: number; bottom: number; left: number };
  };
  blocks: Block[];
}

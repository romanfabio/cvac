import { formatDate, formatRange } from "../i18n/dates.ts";
import { type Labels, labelsFor } from "../i18n/labels.ts";
import type { ResolvedContent } from "../resolve/locale.ts";
import type { FontSpec, ResolvedTheme } from "../theme/resolve.ts";
import type { Block, BlockRole, Group, LayoutDocument, Paragraph, Run, TextStyle } from "./ir.ts";

type Section = ResolvedContent["sections"][number];

const SEP = " · ";

/**
 * Build the default single-column layout. Order of blocks is the semantic
 * reading order, which is what ATS parsers extract.
 */
export function buildLayout(
  content: ResolvedContent,
  theme: ResolvedTheme,
  locale: string,
): LayoutDocument {
  const b = new Builder(theme, labelsFor(locale));
  const basics = content.basics;

  b.header(content);
  if (basics.summary) {
    b.sectionHeading(b.labels.sections.summary);
    for (const p of paragraphs(basics.summary)) b.push(b.body(p));
  }
  for (const s of content.sections) b.section(s);

  return {
    meta: {
      title: basics.title ? `${basics.name} – ${basics.title}` : `${basics.name} – ${b.labels.cv}`,
      author: basics.name,
      lang: locale,
      ...(basics.title ? { subject: basics.title } : {}),
      keywords: keywordsOf(content),
    },
    page: theme.page,
    blocks: b.blocks,
  };
}

class Builder {
  readonly blocks: Block[] = [];
  readonly theme: ResolvedTheme;
  readonly labels: Labels;
  constructor(theme: ResolvedTheme, labels: Labels) {
    this.theme = theme;
    this.labels = labels;
  }

  push(block: Block) {
    this.blocks.push(block);
  }

  style(font: FontSpec, over: Partial<TextStyle> = {}): TextStyle {
    return {
      family: font.family,
      weight: font.weight,
      italic: font.italic,
      size: font.size,
      color: this.theme.colors.text,
      ...over,
    };
  }

  get bodyStyle() {
    return this.style(this.theme.fonts.body);
  }
  get boldStyle() {
    return this.style(this.theme.fonts.body, { weight: 700 });
  }
  get mutedStyle() {
    return this.style(this.theme.fonts.body, { color: this.theme.colors.muted });
  }

  para(role: BlockRole, runs: Run[], over: Partial<Paragraph> = {}): Paragraph {
    return {
      kind: "paragraph",
      role,
      runs,
      indent: 0,
      spaceBefore: 0,
      spaceAfter: 0,
      lineHeight: this.theme.spacing.line,
      ...over,
    };
  }

  body(text: string, over: Partial<Paragraph> = {}): Paragraph {
    return this.para("body", [{ text, style: this.bodyStyle }], { spaceAfter: 2, ...over });
  }

  header(content: ResolvedContent) {
    const { basics } = content;
    const t = this.theme;
    this.push(
      this.para("name", [{ text: basics.name, style: this.style(t.fonts.name) }], {
        headingLevel: 1,
        lineHeight: 1.1,
        spaceAfter: 2,
      }),
    );
    if (basics.title) {
      this.push(
        this.para(
          "headline",
          [
            {
              text: basics.title,
              style: this.style(t.fonts.body, {
                size: t.fonts.body.size + 2,
                color: t.colors.muted,
              }),
            },
          ],
          { spaceAfter: 4 },
        ),
      );
    }

    // Contact details stay in the body as plain text (never in a PDF/Word
    // header), so ATS parsers can find email and phone.
    const contact: Run[] = [];
    const add = (text: string, link?: string) => {
      if (contact.length) contact.push({ text: SEP, style: this.mutedStyle });
      contact.push(
        link ? { text, style: this.mutedStyle, link } : { text, style: this.mutedStyle },
      );
    };
    if (basics.email) add(basics.email, `mailto:${basics.email}`);
    if (basics.phone) add(basics.phone, `tel:${basics.phone.replace(/[^\d+]/g, "")}`);
    const loc = locationText(basics.location);
    if (loc) add(loc);
    if (basics.url) add(stripProtocol(basics.url), basics.url);
    for (const p of basics.profiles ?? []) add(stripProtocol(p.url), p.url);
    if (contact.length) this.push(this.para("contact", contact, { spaceAfter: 0 }));
  }

  sectionHeading(text: string) {
    const t = this.theme;
    this.push(
      this.para(
        "heading",
        [{ text, style: this.style(t.fonts.heading, { color: t.colors.accent }) }],
        {
          headingLevel: 2,
          spaceBefore: t.spacing.section,
          spaceAfter: 5,
          lineHeight: 1.15,
          keepWithNext: true,
          ruleBelow: { color: t.colors.accent, thickness: 0.6, gap: 2 },
        },
      ),
    );
  }

  /** One CV entry: title line (+ right-aligned dates), subtitle, text, bullets. */
  entry(e: {
    title: string;
    titleLink?: string | undefined;
    dates?: string | undefined;
    subtitle?: string | undefined;
    text?: string | undefined;
    highlights?: string[] | undefined;
    footer?: string | undefined;
    first: boolean;
  }) {
    const blocks: Paragraph[] = [];
    const titleRun: Run = { text: e.title, style: this.boldStyle };
    if (e.titleLink) titleRun.link = e.titleLink;
    blocks.push(
      this.para("item-title", [titleRun], {
        headingLevel: 3,
        spaceBefore: e.first ? 0 : this.theme.spacing.item,
        keepWithNext: true,
        ...(e.dates ? { aside: [{ text: e.dates, style: this.mutedStyle }] } : {}),
      }),
    );
    if (e.subtitle) {
      blocks.push(
        this.para(
          "item-subtitle",
          [
            {
              text: e.subtitle,
              style: this.style(this.theme.fonts.body, {
                italic: true,
                color: this.theme.colors.muted,
              }),
            },
          ],
          {
            spaceAfter: 1,
          },
        ),
      );
    }
    for (const p of e.text ? paragraphs(e.text) : []) blocks.push(this.body(p));
    for (const h of e.highlights ?? []) {
      blocks.push(
        this.para("bullet", [{ text: h, style: this.bodyStyle }], {
          indent: 11,
          bullet: "•",
          spaceAfter: 1,
        }),
      );
    }
    if (e.footer)
      blocks.push(
        this.para("body", [{ text: e.footer, style: this.mutedStyle }], { spaceAfter: 1 }),
      );
    const group: Group = { kind: "group", keepTogether: true, blocks };
    this.push(group);
  }

  section(s: Section) {
    const L = this.labels;
    const fmt = this.theme.format.date;
    const range = (start?: string, end?: string) => formatRange(start, end, fmt, L);
    const heading = s.title ?? (s.type === "custom" ? "" : L.sections[s.type]);
    if (s.items.length === 0) return;
    this.sectionHeading(heading);

    switch (s.type) {
      case "experience":
        s.items.forEach((it, i) => {
          this.entry({
            first: i === 0,
            title: it.role,
            dates: range(it.start, it.end),
            subtitle: join([it.company, it.location]),
            titleLink: it.url,
            text: it.summary,
            highlights: it.highlights,
          });
        });
        return;
      case "education":
        s.items.forEach((it, i) => {
          this.entry({
            first: i === 0,
            title: join([it.degree, it.field], ", ") ?? it.institution,
            dates: range(it.start, it.end),
            subtitle: join([
              it.degree || it.field ? it.institution : undefined,
              it.location,
              it.grade,
            ]),
            titleLink: it.url,
            highlights: it.highlights,
          });
        });
        return;
      case "projects":
        s.items.forEach((it, i) => {
          this.entry({
            first: i === 0,
            title: it.name,
            titleLink: it.url,
            dates: range(it.start, it.end),
            text: it.description,
            highlights: it.highlights,
            footer: it.keywords?.length ? it.keywords.join(", ") : undefined,
          });
        });
        return;
      case "certifications":
        s.items.forEach((it, i) => {
          this.entry({
            first: i === 0,
            title: it.name,
            titleLink: it.url,
            subtitle: it.issuer,
            dates: it.date ? formatDate(it.date, fmt, L) : undefined,
          });
        });
        return;
      case "custom":
        s.items.forEach((it, i) => {
          this.entry({
            first: i === 0,
            title: it.title ?? it.subtitle ?? "",
            titleLink: it.url,
            subtitle: it.title ? it.subtitle : undefined,
            dates: it.date ? formatDate(it.date, fmt, L) : range(it.start, it.end),
            text: it.description,
            highlights: it.highlights,
          });
        });
        return;
      case "skills":
        for (const it of s.items) {
          const runs: Run[] = [
            { text: it.level ? `${it.name} (${it.level})` : it.name, style: this.boldStyle },
          ];
          if (it.keywords?.length)
            runs.push({ text: `: ${it.keywords.join(", ")}`, style: this.bodyStyle });
          this.push(this.para("body", runs, { spaceAfter: 2 }));
        }
        return;
      case "languages": {
        const runs: Run[] = [];
        s.items.forEach((it, i) => {
          if (i > 0) runs.push({ text: SEP, style: this.mutedStyle });
          runs.push({ text: it.language, style: this.boldStyle });
          if (it.fluency) runs.push({ text: ` (${it.fluency})`, style: this.bodyStyle });
        });
        this.push(this.para("body", runs, { spaceAfter: 2 }));
        return;
      }
    }
  }
}

function join(parts: (string | undefined)[], sep = SEP): string | undefined {
  const p = parts.filter((x): x is string => !!x);
  return p.length ? p.join(sep) : undefined;
}

function locationText(loc: ResolvedContent["basics"]["location"]): string | undefined {
  if (!loc) return undefined;
  if (typeof loc === "string") return loc;
  return join([loc.city, loc.region, loc.country], ", ");
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Paragraphs separated by blank lines; single newlines fold into spaces. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

/** Skill keywords double as PDF keywords metadata (helps search & ATS). */
function keywordsOf(content: ResolvedContent): string[] {
  const out: string[] = [];
  for (const s of content.sections) {
    if (s.type === "skills") for (const it of s.items) out.push(...(it.keywords ?? []));
  }
  return [...new Set(out)];
}

import { describe, expect, it } from "vitest";
import type { Block, LayoutDocument, Paragraph, TextStyle } from "../src/index.ts";
import { type Measurer, typeset } from "../src/index.ts";

/** Monospace fake: every char is size/2 wide; ascent 0.8, descent 0.2. */
const mono: Measurer = {
  width: (t, s) => [...t].length * s.size * 0.5,
  ascent: (s) => s.size * 0.8,
  descent: (s) => s.size * 0.2,
};

const style: TextStyle = { family: "X", weight: 400, italic: false, size: 10, color: "#000000" };

/** Page with 100pt usable width (20 chars at size 10) and 100pt height (10 lines). */
function doc(blocks: Block[]): LayoutDocument {
  return {
    meta: { title: "t", author: "a", lang: "en" },
    page: { width: 120, height: 120, margins: { top: 10, right: 10, bottom: 10, left: 10 } },
    blocks,
  };
}

function p(text: string, over: Partial<Paragraph> = {}): Paragraph {
  return {
    kind: "paragraph",
    role: "body",
    runs: [{ text, style }],
    indent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    lineHeight: 1,
    ...over,
  };
}

const texts = (pages: ReturnType<typeof typeset>) =>
  pages.map((pg) => pg.items.flatMap((i) => (i.type === "text" ? [i.text] : [])));

describe("typeset: line breaking", () => {
  it("wraps greedily at word boundaries and trims trailing spaces", () => {
    const pages = typeset(doc([p("aaaa bbbb cccc dddd eeee ffff")]), mono);
    expect(texts(pages)).toEqual([["aaaa bbbb cccc dddd", "eeee ffff"]]);
  });

  it("reserves room for the aside on the first line only", () => {
    const pages = typeset(doc([p("aaaa bbbb ccccc", { aside: [{ text: "2021", style }] })]), mono);
    // 100 - 20 (aside) - 8 (gap) = 72pt -> 14 chars fit on line one, 15 do not
    expect(texts(pages)).toEqual([["aaaa bbbb", "2021", "ccccc"]]);
    const aside = pages[0]?.items.find((i) => i.type === "text" && i.text === "2021");
    expect(aside && aside.type === "text" && aside.x).toBe(110 - 20);
  });

  it("never breaks after a hyphen (ATS de-hyphenation safety)", () => {
    const pages = typeset(doc([p("aaaaaaaaaaaaaaa event-driven")]), mono);
    expect(texts(pages)).toEqual([["aaaaaaaaaaaaaaa", "event-driven"]]);
  });

  it("hard-splits words wider than the line", () => {
    const pages = typeset(doc([p("x".repeat(25))]), mono);
    expect(texts(pages)).toEqual([["x".repeat(20), "x".repeat(5)]]);
  });

  it("merges runs with the same style into one text item", () => {
    const para = p("", {
      runs: [
        { text: "ab ", style },
        { text: "cd", style: { ...style } },
      ],
    });
    expect(texts(typeset(doc([para]), mono))).toEqual([["ab cd"]]);
  });

  it("does not break between differently styled runs without a break opportunity", () => {
    const bold = { ...style, weight: 700 };
    const para = p("", {
      runs: [
        { text: "aaaaaaaaaaaaaaaa Skill", style: bold },
        { text: ": x", style },
      ],
    });
    expect(texts(typeset(doc([para]), mono))).toEqual([["aaaaaaaaaaaaaaaa", "Skill", ": x"]]);
  });
});

describe("typeset: pagination", () => {
  const line = (i: number) => p(`line${i}`);

  it("flows onto new pages", () => {
    const pages = typeset(doc(Array.from({ length: 15 }, (_, i) => line(i))), mono);
    expect(texts(pages).map((t) => t.length)).toEqual([10, 5]);
  });

  it("keeps a heading with the start of the next block", () => {
    const blocks: Block[] = [
      ...Array.from({ length: 9 }, (_, i) => line(i)),
      p("Heading", { keepWithNext: true }),
      p("body"),
    ];
    expect(texts(typeset(doc(blocks), mono))).toEqual([
      Array.from({ length: 9 }, (_, i) => `line${i}`),
      ["Heading", "body"],
    ]);
  });

  it("moves a keep-together group to the next page when it fits there", () => {
    const blocks: Block[] = [
      ...Array.from({ length: 8 }, (_, i) => line(i)),
      { kind: "group", keepTogether: true, blocks: [p("g1"), p("g2"), p("g3")] },
    ];
    expect(texts(typeset(doc(blocks), mono))[1]).toEqual(["g1", "g2", "g3"]);
  });

  it("splits long paragraphs leaving at least two lines on each page", () => {
    const words = Array.from({ length: 6 }, (_, i) => `w${i}${"x".repeat(17)}`).join(" ");
    // 5 lines used, 5 free: 5 paragraph lines would fit, but that leaves a
    // single widow line, so only 4 go on page one and 2 move on.
    const blocks: Block[] = [...Array.from({ length: 5 }, (_, i) => line(i)), p(words)];
    const out = texts(typeset(doc(blocks), mono));
    expect(out.map((pg) => pg.length)).toEqual([9, 2]);
  });

  it("collapses space-before at the top of a page", () => {
    const pages = typeset(doc([p("a", { spaceBefore: 50 })]), mono);
    const first = pages[0]?.items[0];
    expect(first && first.type === "text" && first.y).toBeCloseTo(10 + 8);
  });

  it("is deterministic", () => {
    const blocks = Array.from({ length: 30 }, (_, i) =>
      p(`para ${i} with some words to wrap around`),
    );
    expect(JSON.stringify(typeset(doc(blocks), mono))).toBe(
      JSON.stringify(typeset(doc(blocks), mono)),
    );
  });
});

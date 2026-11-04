import { contentJsonSchema, themeJsonSchema } from "@cvac/core";
import { describe, expect, it } from "vitest";
import { completeYaml, type JsonSchema } from "../src/complete.ts";

const cv = contentJsonSchema() as JsonSchema;
const theme = themeJsonSchema() as JsonSchema;

/** Complete at the "|" marker. */
function at(doc: string, schema = cv) {
  const offset = doc.indexOf("|");
  const r = completeYaml(doc.replace("|", ""), offset, schema);
  return r ? { from: r.from, labels: r.options.map((o) => o.label), options: r.options } : null;
}

describe("completeYaml", () => {
  it("offers top-level keys, required first", () => {
    const r = at("|");
    expect(r?.labels.slice(0, 1)).toEqual(["basics"]);
    expect(r?.labels).toEqual(expect.arrayContaining(["version", "meta", "sections"]));
    expect(r?.labels).not.toContain("$schema");
  });

  it("filters by the typed prefix and replaces it", () => {
    expect(at("sec|")).toMatchObject({ from: 0, labels: ["sections"] });
    expect(at("sec|")?.options[0]?.apply).toBe("sections: ");
  });

  it("offers keys of nested mappings, skipping ones already present", () => {
    const r = at("basics:\n  name: Jane\n  |\n  email: j@example.com\n");
    expect(r?.labels).toContain("title");
    expect(r?.labels).not.toContain("name");
    expect(r?.labels).not.toContain("email");
    expect(r?.options.find((o) => o.label === "title")?.info).toContain("Headline");
  });

  it("follows lists and narrows section items by their type", () => {
    const doc = "sections:\n  - type: experience\n    items:\n      - company: Acme\n        |";
    const r = at(doc);
    expect(r?.labels).toEqual(expect.arrayContaining(["role", "start", "end", "highlights"]));
    expect(r?.labels).not.toContain("company");
    expect(r?.labels).not.toContain("institution"); // education only
  });

  it("offers section keys for a new list item, narrowed after type is set", () => {
    expect(at("sections:\n  - |")?.labels).toEqual(
      expect.arrayContaining(["type", "items", "id", "title"]),
    );
    const custom = at("sections:\n  - type: custom\n    |");
    expect(custom?.labels).toEqual(expect.arrayContaining(["items", "title"]));
  });

  it("offers enum and const values", () => {
    expect(at("sections:\n  - type: |")?.labels).toEqual([
      "experience",
      "education",
      "skills",
      "languages",
      "projects",
      "certifications",
      "custom",
    ]);
    expect(at("sections:\n  - type: ed|")).toMatchObject({ from: 20, labels: ["education"] });
    expect(at("page:\n  size: |", theme)?.labels).toEqual(["A4", "Letter"]);
    expect(at("layout:\n  type: |", theme)?.labels).toEqual(["single", "sidebar"]);
    expect(at("photo:\n  show: |", theme)?.labels).toEqual(["true", "false"]);
  });

  it("knows literal alternatives inside unions (end: present)", () => {
    const doc = "sections:\n  - type: experience\n    items:\n      - company: A\n        end: p|";
    expect(at(doc)?.labels).toEqual(["present"]);
  });

  it("handles lists that are not indented under their key", () => {
    const doc = "sections:\n- type: skills\n  items:\n  - name: Cloud\n    |";
    expect(at(doc)?.labels).toEqual(expect.arrayContaining(["keywords", "level"]));
  });

  it("stays quiet in comments and free text", () => {
    expect(at("# |")).toBeNull();
    expect(at("basics:\n  name: Jane D|")).toBeNull();
  });
});

describe("completeYaml on realistic documents", () => {
  it("does not mix up neighbouring list items", () => {
    const doc = "sections:\n  - type: skills\n    items: []\n\n  - type: |";
    expect(at(doc)?.labels).toContain("education");
    const next =
      "sections:\n  - type: skills\n    items: []\n  - type: experience\n    |\n  - type: education\n";
    const r = at(next);
    expect(r?.labels).toEqual(expect.arrayContaining(["items", "title"]));
    expect(r?.labels).not.toContain("type"); // present in this item
  });

  it("completes everywhere in the starter CV without throwing", async () => {
    const { STARTER_CV } = await import("@cvac/core");
    const at1 = STARTER_CV.indexOf("  - type: education") + "  - type: ".length;
    const probe = `${STARTER_CV.slice(0, at1)}e${STARTER_CV.slice(at1 + "education".length)}`;
    expect(completeYaml(probe, at1 + 1, cv)?.options.map((o) => o.label)).toEqual([
      "experience",
      "education",
    ]);
    for (let i = 0; i <= STARTER_CV.length; i += 7) completeYaml(STARTER_CV, i, cv);
  });
});

import { STARTER_THEME } from "@cvac/core";
import { describe, expect, it } from "vitest";
import { readExtends, setExtends } from "../src/themeFile.ts";

describe("theme picker edits", () => {
  it("reads the base as written, quoted or not, ignoring comments", () => {
    expect(readExtends(STARTER_THEME)).toBe("default");
    expect(readExtends("extends: classic  # serif\n")).toBe("classic");
    expect(readExtends('extends: "./base.yaml"\n')).toBe("./base.yaml");
    expect(readExtends("page:\n  extends: nope\n")).toBeUndefined();
    expect(readExtends("extends:\n")).toBeUndefined();
    expect(readExtends("")).toBeUndefined();
  });

  it("replaces the value in place, keeping the rest of the file", () => {
    const next = setExtends(STARTER_THEME, "classic");
    expect(readExtends(next)).toBe("classic");
    expect(next).toBe(STARTER_THEME.replace("extends: default", "extends: classic"));
    expect(setExtends("extends: modern # mine\npage: {}\n", "compact")).toBe(
      "extends: compact  # mine\npage: {}\n",
    );
  });

  it("adds the line after version:, or after the leading comments", () => {
    expect(setExtends("version: 1\npage: {}\n", "modern")).toBe(
      "version: 1\nextends: modern\npage: {}\n",
    );
    expect(setExtends("version: 1", "modern")).toBe("version: 1\nextends: modern\n");
    expect(setExtends("# my theme\n\npage: {}\n", "modern")).toBe(
      "# my theme\n\nextends: modern\npage: {}\n",
    );
    expect(setExtends("", "sidebar")).toBe("extends: sidebar\n");
  });
});

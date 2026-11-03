import { z } from "zod";
import { Content } from "./model/content.ts";
import { Theme } from "./model/theme.ts";

/**
 * JSON Schemas describe the *input* shape (what users write), so editors
 * (VS Code YAML extension, Monaco) can validate and autocomplete.
 */
export function contentJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(Content, { io: "input", unrepresentable: "any" }),
    title: "cvac CV content",
  };
}

export function themeJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(Theme, { io: "input", unrepresentable: "any" }),
    title: "cvac theme",
  };
}

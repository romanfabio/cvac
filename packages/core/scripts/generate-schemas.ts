// Writes JSON Schemas for editor support. Run with Node 24 (native TS).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contentJsonSchema, themeJsonSchema } from "../src/schema.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
mkdirSync(outDir, { recursive: true });
const write = (name: string, schema: unknown) =>
  writeFileSync(join(outDir, name), `${JSON.stringify(schema, null, 2)}\n`);

write("cv.schema.json", contentJsonSchema());
write("theme.schema.json", themeJsonSchema());
console.log(`Schemas written to ${outDir}`);

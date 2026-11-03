# CV as Code (cvac)

Write your CV as code and get deterministic, ATS-friendly **PDF** and **DOCX** output.

- **Content and theme are separate.** `cv.yaml` holds what you did, and `theme.yaml` holds how it looks.
- **Deterministic.** The same input and the same cvac version produce byte-identical files.
- **ATS-aware.** Layout is free, and a linter (on by default) warns about choices that hurt HR scanners.
- **Variants and languages.** Tag items to build tailored variants, and write text as `{ en: ..., it: ... }`.

> Status: early development. The model and parsing (M1) are done. Rendering, the CLI and the web editor are next.

## Packages

| Package | Description |
|---|---|
| [`@cvac/core`](packages/core) | Model, YAML parsing with located diagnostics, JSON Schemas, and later layout and renderers |

## Editor support

Add this line at the top of your `cv.yaml` to get validation and autocomplete in VS Code (with the YAML extension):

```yaml
# yaml-language-server: $schema=<path-to>/packages/core/schemas/cv.schema.json
```

See [`fixtures/basic/cv.yaml`](fixtures/basic/cv.yaml) for a complete example.

## Development

Requires Node 24+.

```bash
npm install
npm test
npm run build
npm run lint
```

## License

MIT

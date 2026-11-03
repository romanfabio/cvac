# CV as Code (cvac)

Write your CV as code and get deterministic, ATS-friendly **PDF** and **DOCX** output.

- **Content and theme are separate.** `cv.yaml` holds what you did, and `theme.yaml` holds how it looks.
- **Deterministic.** The same input and the same cvac version produce byte-identical files.
- **ATS-aware.** Layout is free, and a linter (on by default) warns about choices that hurt HR scanners.
- **Variants and languages.** Tag items to build tailored variants, and write text as `{ en: ..., it: ... }`.

> Status: early development. Model, parsing, PDF and DOCX rendering with the default theme work (M1–M3). The CLI and the web editor are next.

## Packages

| Package                         | Description                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`@cvac/core`](packages/core)   | Model, YAML parsing with located diagnostics, JSON Schemas, i18n, layout, PDF and DOCX renderers |
| [`@cvac/fonts`](packages/fonts) | Bundled fonts (SIL OFL) and a Node loader                                                        |

## How it works

```
cv.yaml ─parse─► Content ─resolve locale─► layout IR (flow, semantic order) ─► PDF (typeset + pdfkit)
theme.yaml ─parse─► Theme ─layer over default─┘                              └► DOCX (native Word styles)
```

Determinism: only bundled fonts are embedded, document dates are fixed
(`2000-01-01` unless you pass `date`), there is no `Intl` or platform data in
the output path, and compression is pure JS. Golden SHA-256 hashes in
[`fixtures/golden-pdf.json`](fixtures/golden-pdf.json) and [`fixtures/golden-docx.json`](fixtures/golden-docx.json) are checked in CI on Linux,
Windows and macOS. After an intended output change, run
`UPDATE_GOLDEN=1 npm test`.

DOCX output uses native Word constructs: built-in heading styles, right tab
stops for dates, real bullet lists and keep-with-next rules, with no text
boxes, tables or headers. The bundled fonts are embedded by default (about
0.5 MB), so the document looks the same on every machine. Pass
`embedFonts: false` for a small file. Word then substitutes a similar font,
guided by the font table, when the font is not installed.

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

# CV as Code (cvac)

Write your CV as code and get deterministic, ATS-friendly **PDF** and **DOCX** output.

- **Content and theme are separate.** `cv.yaml` holds what you did, and `theme.yaml` holds how it looks.
- **Deterministic.** The same input and the same cvac version produce byte-identical files.
- **ATS-aware.** Layout is free, and a linter (on by default) warns about choices that hurt HR scanners.
- **Variants and languages.** Tag sections, items or bullets to build tailored variants. Write text as `{ en: ..., it: ... }`.

> Status: early development. Model, parsing, PDF/DOCX rendering, the `cvac` CLI, the ATS linter, variants, themes with sidebar layouts and photos, and the web editor work (M1–M8).

## Packages

| Package                         | Description                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`@cvac/core`](packages/core)   | Model, YAML parsing with located diagnostics, JSON Schemas, i18n, layout, PDF and DOCX renderers |
| [`@cvac/cli`](packages/cli)     | The `cvac` command line                                                                          |
| [`apps/web`](apps/web)          | Web editor: YAML on the left, live PDF on the right, all in the browser                          |
| [`@cvac/fonts`](packages/fonts) | Bundled fonts (SIL OFL) and a Node loader                                                        |

## Quick start

```bash
cvac init                          # starter cv.yaml + theme.yaml + editor schemas
cvac build                         # -> cv.pdf
cvac build --format all --lang en,it   # -> cv.en.pdf, cv.en.docx, cv.it.pdf, cv.it.docx
cvac build --variant all           # one file per variant: cv.backend.pdf, cv.lead.pdf
cvac watch                         # rebuild on every save
cvac validate --lang en,it         # check without writing files
cvac lint --lang en,it --strict    # validation + ATS linter, fail on warnings (CI)
```

`build` options:
- `-t, --theme <file>`: theme file. By default, `theme.yaml` next to the CV is used if it exists.
- `-o, --out <path>`: output file, or a directory when there are several outputs.
- `--date <iso>`: date written into the files. `SOURCE_DATE_EPOCH` also works.
- `--no-embed-fonts`: build a smaller DOCX without the fonts inside.
- `--no-lint`: skip the ATS linter.

Exit codes: `0` ok, `1` problems in your files, `2` bad usage.

In this repo, run the CLI from source with `npm run cvac -- build ...`.

## Themes

A theme only lists what it changes from its base:

```yaml
extends: sidebar # built-ins: default (one column), sidebar; or a file: ./base.yaml
layout:
  side: right
  width: 30%
  sidebar: [summary, skills, languages] # section ids (default: the type); the rest go in main
photo: { position: sidebar, size: 28mm, shape: circle } # or header-right, header-left
tokens:
  colors: { accent: "#7a1f3d", sidebarBackground: "#f4eef1" }
```

How themes combine:
- Objects merge key by key.
- Lists and single values replace the base's value.
- Theme files can extend other theme files; paths are relative to each file.

The photo path in `basics.photo` is relative to the CV file. It is
cover-cropped to a square, circle or rounded shape in both the PDF and the
DOCX.

The PDF follows the layout. The DOCX is always one column, in CV order,
because ATS portals read Word files as linear text. The linter's
`multi-column` warning reminds you of this when you use a sidebar.

## Variants

You can keep one CV and build versions tailored to different roles:

```yaml
meta:
  variants:
    backend:
      tags: [backend] # keep items tagged backend, plus every untagged item
      title: Senior Backend Engineer # replaces basics.title in this variant
    lead:
      tags: [lead]
      exclude: [hands-on] # drop anything tagged hands-on
      sections: [skills, experience, education] # pick sections and their order
      summary: Engineering leader who grows teams.

sections:
  - type: experience
    items:
      - company: Acme
        role: Engineering Manager
        tags: [lead]
        highlights:
          - Grew the team from 3 to 9 engineers
          - { text: Rewrote billing in Go, tags: [backend, hands-on] }
```

Commands:
- `cvac build --variant backend` builds `cv.backend.pdf`.
- `--variant backend,lead` builds both, and `--variant all` builds every named variant.
- A bare tag works as an ad-hoc variant: `--variant hands-on`.
- `cvac variants` lists the variants and every tag in use.

Section ids default to the section type. Lint findings and warnings for a
variant point at the matching line in your file.

## ATS linter

`cvac build` and `cvac lint` check what helps or hurts applicant tracking
systems and human readers. Examples:
- non-standard section headings
- missing dates, or an end date before the start date
- missing email, phone or headline
- no skills section, or empty sections
- photos and emoji
- characters the font cannot draw
- small fonts, low contrast and narrow margins
- more than two pages

Errors block the build. Warnings and notes are printed, but the files are
still written. Run `cvac lint --list` for every rule and its default level.
To change a level, add this to `cv.yaml`:

```yaml
meta:
  lint: { photo: off, missing-phone: warning }
```

Some ATS safety is built into the output rather than linted:
- text is extracted in reading order
- lines break only at spaces, so URLs, emails and hyphenated words stay intact
- contact details stay in the page body, never in a header
- the DOCX uses native heading styles and lists

A round-trip test checks that every piece of text can be read back from the
PDF and the DOCX, in order.

## Web editor

```bash
npm run web        # http://localhost:5173
```

The web editor builds your CV in a Web Worker as you type, using the same
core code as the CLI. Nothing is uploaded: files, the photo and your edits
stay in the browser, which saves them locally.

- `cv.yaml` and `theme.yaml` each have a tab, with schema-based completion
  and cvac's own diagnostics shown inline and in a problems list.
- You can pick the language and the variant, choose the photo, and download
  the PDF or DOCX.
- The status bar shows the PDF's SHA-256. The same files give the same hash
  in the browser and with `cvac build`.

`npm run build` produces a static site in `apps/web/dist` that any static
host can serve.

## How it works

```
cv.yaml ─parse─► Content ─resolve locale─► layout IR (flow, semantic order) ─► PDF (typeset + pdfkit)
theme.yaml ─parse─► Theme ─layer over default─┘                              └► DOCX (native Word styles)
```

Determinism:
- Only bundled fonts are embedded.
- Document dates are fixed (`2000-01-01` unless you pass `date`).
- There is no `Intl` or platform data in the output path.
- Compression is always pure-JS fflate. In Node too, cvac uses pdfkit's
  browser build, because its Node build uses the system zlib. Golden SHA-256 hashes in
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

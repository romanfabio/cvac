# CV as Code (cvac)

Write your CV as code and get deterministic, ATS-friendly **PDF** and **DOCX** output.

- **Content and theme are separate.** `cv.yaml` holds what you did, and `theme.yaml` holds how it looks.
- **Deterministic.** The same files and the same cvac version produce byte-identical output, in Node and in the browser.
- **ATS-aware.** Layout is up to you, and a linter (on by default) warns about choices that hurt applicant tracking systems.
- **One CV, many versions.** Write text in several languages, and tag entries to build variants tailored to a role.
- **CLI and web editor.** Use the `cvac` command line, or a browser editor with live preview. Both run the same core.

> **Status:** early development. Everything described here works. cvac is not published to npm yet, so you run it from this repository (see [Getting started](#getting-started)).

## Contents

- [Getting started](#getting-started)
- [Writing your CV](#writing-your-cv)
- [Languages](#languages)
- [Variants](#variants)
- [Themes](#themes)
- [ATS linter](#ats-linter)
- [Output](#output)
- [CLI reference](#cli-reference)
- [Web editor](#web-editor)
- [Editor support](#editor-support)
- [How it works](#how-it-works)
- [Development](#development)
- [Roadmap](#roadmap)
- [License](#license)

## Getting started

Requires Node 24 or later.

```bash
git clone <this repository> cvac
cd cvac
npm install
npm run build
```

Point a `cvac` command at the built CLI, so you can use it in any folder:

```bash
alias cvac="node $PWD/packages/cli/dist/bin.js"                       # bash / zsh
```

```powershell
$cvacBin = "$PWD\packages\cli\dist\bin.js"; function cvac { node $cvacBin @args }   # PowerShell
```

Run either line in the repository folder, or add it to your shell profile with the full path.

Then create your CV in a folder of its own:

```bash
mkdir ~/my-cv && cd ~/my-cv
cvac init                                # starter cv.yaml, theme.yaml and editor schemas
cvac build                               # -> cv.pdf
cvac build --format all --lang en,it     # -> cv.en.pdf, cv.en.docx, cv.it.pdf, cv.it.docx
cvac watch                               # rebuild on every save
```

The starter CV passes every check. Edit it and rebuild, or open the [web editor](#web-editor) with `npm run web`.

## Writing your CV

A CV is a YAML file with `basics` and a list of `sections`:

```yaml
basics:
  name: Jane Doe
  title: Senior Software Engineer          # headline
  email: jane@example.com
  phone: "+39 333 000 0000"
  location: { city: Milano, country: Italy }
  photo: photo.jpg                         # optional, relative to this file
  summary: Backend engineer with 10 years of experience in distributed systems.
  profiles:
    - { network: GitHub, url: https://github.com/janedoe }

sections:
  - type: experience
    items:
      - company: Acme Corp
        role: Senior Developer
        start: 2021-03
        end: present
        highlights:
          - "Impact first: what changed thanks to you, with numbers"
          - Led a team of 5 engineers

  - type: skills
    items:
      - { name: Languages, keywords: [TypeScript, Go] }
```

`basics.name` is required, plus at least one way to contact you: `email`, `phone`, `url` or `profiles`.

Section types and their item fields:

| `type` | Item fields |
| --- | --- |
| `experience` | `company`, `role`, `location`, `start`, `end`, `url`, `summary`, `highlights` |
| `education` | `institution`, `degree`, `field`, `location`, `grade`, `start`, `end`, `url`, `highlights` |
| `skills` | `name`, `level`, `keywords` |
| `languages` | `language`, `fluency` |
| `projects` | `name`, `description`, `url`, `start`, `end`, `highlights`, `keywords` |
| `certifications` | `name`, `issuer`, `date`, `url` |
| `custom` | `title`, `subtitle`, `date` or `start`/`end`, `description`, `url`, `highlights` (the section itself needs a `title`) |

Every section can also have:
- `title` to override the default heading.
- `id`, which themes and variants use to refer to it. It defaults to the type; the summary's id is `summary`.
- `tags`, used by [variants](#variants).

More details:
- **Dates** are `2021`, `2021-03` or `2021-03-15`, and `end` can also be `present`.
- **Quoting:** quote any text that contains `: `, otherwise YAML reads it as a key. cvac tells you when this happens.

Mistakes are reported with the exact line and column, a snippet of your file and a hint:

```text
error[unknown-property]: Unknown property 'emial' at 'basics'
  --> cv.yaml:3:3
  |
3 |   emial: jane@example.com
  |   ^^^^^
```

[`fixtures/basic/cv.yaml`](fixtures/basic/cv.yaml) is a complete example.

## Languages

Any text can be a single string, or one string per language:

```yaml
meta:
  defaultLocale: en
  locales: [en, it]

basics:
  title: { en: Software Engineer, it: Ingegnere del Software }
```

`cvac build --lang it` builds the Italian version. Missing translations fall back to the default language, with a warning that points at the field. Section headings, `Present` and month names are translated as well. English and Italian are built in; other languages use the English labels.

## Variants

You can keep one CV and build versions tailored to different roles:

```yaml
meta:
  variants:
    backend:
      tags: [backend]                    # keep items tagged backend, plus every untagged item
      title: Senior Backend Engineer     # replaces basics.title in this variant
    lead:
      tags: [lead]
      exclude: [hands-on]                # drop anything tagged hands-on
      sections: [skills, experience]     # pick sections and their order
      summary: Engineering leader who grows teams.

sections:
  - type: experience
    items:
      - company: Acme
        role: Engineering Manager
        start: 2022-01
        end: present
        tags: [lead]
        highlights:
          - Grew the team from 3 to 9 engineers
          - { text: Rewrote billing in Go, tags: [backend, hands-on] }
  - type: skills
    items:
      - { name: Backend, keywords: [Go, PostgreSQL], tags: [backend] }
      - { name: Leadership, keywords: [Hiring, Coaching], tags: [lead] }
```

Tags work on sections, items and individual bullets. Untagged content is always kept. A tagged element is kept when it shares a tag with the variant and has none of its `exclude` tags.

- `cvac build --variant backend` builds `cv.backend.pdf`. Use `--variant backend,lead` for several, or `--variant all` for every named variant.
- A tag on its own works as an ad-hoc variant, for example `--variant hands-on`.
- `cvac variants` lists the variants and every tag in use.

Warnings for a variant still point at the right line of your file.

## Themes

A theme lists only what it changes from its base:

```yaml
extends: sidebar          # built-ins: default (one column), sidebar; or a file: ./base.yaml
page:
  size: A4                # or Letter
  margins: 16mm           # or { top, right, bottom, left }
layout:
  type: sidebar           # or single
  side: right
  width: 30%
  sidebar: [summary, skills, languages]   # section ids; everything else goes in the main column
photo: { position: sidebar, size: 28mm, shape: circle }   # or header-right / header-left; square, rounded
tokens:
  fonts:
    body: { family: Source Sans 3, size: 10pt }
  colors: { text: "#1a1a1a", muted: "#555555", accent: "#7a1f3d", sidebarBackground: "#f4eef1" }
  spacing: { section: 12pt, item: 7pt, line: 1.25 }
format:
  date: MMM YYYY          # or MMMM YYYY, MM/YYYY, YYYY
```

- **Lengths** are points (`10`) or `pt`, `mm`, `cm` or `in` values.
- **Theme file:** `cvac` uses `theme.yaml` next to the CV automatically, or the file you pass with `--theme`. Without one, you get the built-in `default` theme.
- **Combining themes:** objects merge key by key, and lists and single values replace the base's value.
- **Theme files** can extend other theme files; paths are relative to each file.

The photo is cover-cropped to the chosen shape in both formats. `photo: { show: false }` hides it, for example for submissions where photos are not expected.

## ATS linter

`cvac build` and `cvac lint` check what helps or hurts applicant tracking systems and human readers:

| Rule | Default | Catches |
| --- | --- | --- |
| `nonstandard-heading` | warning | Section titles ATS may not recognize (English and Italian standard headings are accepted) |
| `missing-dates` | warning | Jobs without a start date, education without any date |
| `date-order` | error | An end date before the start date |
| `missing-email` | warning | No email address |
| `missing-phone` | note | No phone number |
| `missing-headline` | note | No `basics.title` |
| `no-skills` | note | No skills section |
| `empty-section` | warning | Sections with no items, which disappear from the output |
| `photo` | warning | A photo, which many ATS drop and some countries discourage |
| `emoji` | warning | Emoji and pictographs |
| `missing-glyphs` | error | Characters the font cannot draw |
| `small-font` | warning | Text below 9pt |
| `low-contrast` | warning | Colors that fall below the WCAG contrast ratios, on white or on the sidebar background |
| `narrow-margins` | note | Margins under 12mm |
| `too-long` | note | More than two pages |
| `multi-column` | warning | A sidebar layout in the PDF |

The theme rules only flag values you set yourself.

Errors block the build before anything is written. Warnings and notes are printed, but the files are still created. Run `cvac lint --list` for the rules with their rationale. To change a level, add this to your CV:

```yaml
meta:
  lint: { photo: off, missing-phone: warning }
```

## Output

**Built-in ATS safety:**
- The PDF's text reads in semantic order, even with a sidebar (header, then main column, then sidebar).
- Lines break only at spaces, so URLs, emails and hyphenated words are never split.
- Contact details stay in the page body, never in a page header.

A test checks that every piece of text can be read back from both formats, in order.

**DOCX:**
- **Structure:** it uses native Word features: heading styles, right-aligned dates on a tab stop, real bullet lists, and rules that keep entries together. It has no text boxes, tables or page headers.
- **One column:** it always has one column, in CV order, because ATS portals read Word files as linear text. The `multi-column` warning reminds you of this when the PDF has a sidebar.
- **Fonts:** the bundled fonts are embedded, about 0.5 MB, so the document looks the same everywhere. `--no-embed-fonts` gives a small file, and Word then picks a similar sans-serif when the font isn't installed.

**Determinism:**
- Only the bundled fonts are used, never system fonts.
- The document date is fixed: `2000-01-01` by default, or set it with `--date` or `SOURCE_DATE_EPOCH`.
- Dates and labels are formatted from built-in tables, not the operating system's locale data.
- Compression is always pure JavaScript. In Node, cvac also uses pdfkit's browser build, because its Node build compresses with the system zlib.
- The Word file's internal IDs and zip timestamps are normalized.

The same files give the same SHA-256 in Node and in the browser. The test suite compares output against the hashes in [`fixtures/golden-pdf.json`](fixtures/golden-pdf.json) and [`fixtures/golden-docx.json`](fixtures/golden-docx.json), and the [CI workflow](.github/workflows/ci.yml) runs them on Linux, Windows and macOS.

## CLI reference

| Command | What it does |
| --- | --- |
| `cvac init [dir]` | Creates a starter `cv.yaml`, `theme.yaml` and editor schemas. `--force` overwrites existing files |
| `cvac build [cv]` | Builds the CV (default `cv.yaml`) |
| `cvac watch [cv]` | Builds, then rebuilds on every change to the CV, the theme or the photo (same as `build --watch`) |
| `cvac validate [cv]` | Checks the files without writing anything |
| `cvac lint [cv]` | Runs validation plus the ATS linter. `--strict` also fails on warnings; `--list` shows the rules |
| `cvac variants [cv]` | Lists the named variants and the tags in use |
| `cvac schema [dir]` | Writes the JSON Schemas for editor autocomplete into `<dir>/.cvac/schemas` |

`build` and `watch` options:

| Option | Meaning |
| --- | --- |
| `-f, --format <formats>` | `pdf` (default), `docx`, `pdf,docx` or `all` |
| `-l, --lang <locales>` | Language or languages, e.g. `it` or `en,it` (default: `meta.defaultLocale`) |
| `-v, --variant <names>` | Variants or tags, e.g. `backend,lead`, or `all` |
| `-t, --theme <file>` | Theme file (default: `theme.yaml` next to the CV, if there is one) |
| `-o, --out <path>` | Output file, or a folder when building several outputs |
| `--date <iso>` | Date written into the files (default: `SOURCE_DATE_EPOCH`, or 2000-01-01) |
| `--no-embed-fonts` | Smaller DOCX without embedded fonts |
| `--no-lint` | Skip the ATS linter |

`validate` and `lint` also take `--theme`, `--lang` and `--variant`.

Output files are named `<cv>.<variant>.<lang>.<ext>`, for example `cv.backend.it.pdf`. Each part appears only when you pass that option.

Exit codes are `0` for success, `1` for problems in your files and `2` for wrong command usage.

## Web editor

```bash
npm run web        # http://localhost:5173
```

The editor rebuilds your CV in a Web Worker as you type, with the same core code as the CLI. Nothing is uploaded: your files and photo stay in the browser, which saves them locally.

- `cv.yaml` and `theme.yaml` each have a tab, with schema-based completion. cvac's diagnostics appear inline and in a problems list; clicking one jumps to the line.
- The toolbar picks the language and the variant, sets the photo file, and downloads the PDF or DOCX.
- The status bar shows the page count, build time and the PDF's SHA-256. It matches `cvac build` for the same files.

`npm run build` also produces a static site in `apps/web/dist` that any static host can serve. In the web editor, `extends` can only name a built-in theme.

## Editor support

`cvac init` and `cvac schema` write JSON Schemas to `.cvac/schemas/`. The starter files start with a comment that points the VS Code YAML extension at them, which gives you validation and autocomplete:

```yaml
# yaml-language-server: $schema=./.cvac/schemas/cv.schema.json
```

## How it works

```text
cv.yaml ─parse─► content ─variant─► locale ─┐
                                            ├─► layout (semantic order) ─┬─► PDF  (typesetting + pdfkit)
theme.yaml ─parse─► theme ─extends/merge────┘                            └─► DOCX (native Word, one column)
                            lint ◄── content, theme, page count
```

| Package | Contents |
| --- | --- |
| [`@cvac/core`](packages/core) | Model, YAML parsing with located diagnostics, JSON Schemas, variants, languages, themes, layout, the PDF and DOCX renderers, and the linter. It runs unchanged in Node and in browsers, and reads no files |
| [`@cvac/fonts`](packages/fonts) | The bundled fonts (Source Sans 3) and a Node loader |
| [`@cvac/cli`](packages/cli) | The `cvac` command line |
| [`apps/web`](apps/web) | The web editor (Vite, React, CodeMirror, pdf.js) |

## Development

```bash
npm test                   # all tests
npm run typecheck
npm run lint               # Biome; npm run format applies fixes
npm run build              # core, fonts, cli, web
npm run cvac -- lint fixtures/basic/cv.yaml    # the CLI from the TypeScript sources (paths relative to the repo root)
npm run web                # the web editor dev server
```

- **Golden hashes:** after an intended change to the output, refresh them with `UPDATE_GOLDEN=1 npm test`, and check that only the cases you expected changed.
- **Fixtures:** [`fixtures/`](fixtures) holds the sample CVs used by the tests: `basic`, `long`, `variants` and `sidebar` (with a generated placeholder photo).
- **Sources in development:** packages expose their sources under a `source` export condition, so the CLI, the tests and the web dev server always run the current code rather than a stale build.

## Roadmap

- A custom, more readable CV language (Bicep-like), with a language server and a VS Code extension. YAML stays supported, on the same model.
- Contact icons, from a permissively licensed icon set.
- Publishing the packages to npm and hosting the web editor.

## License

MIT. The bundled Source Sans 3 fonts are under the SIL Open Font License 1.1 ([packages/fonts/files/source-sans-3/OFL.txt](packages/fonts/files/source-sans-3/OFL.txt)).

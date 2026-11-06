# CLAUDE.md

Guidance for working in this repository. [README.md](README.md) describes what cvac does for users. This file covers how to change it without breaking its guarantees.

## What this is

CV as Code: a CV written in YAML (`cv.yaml` for content, `theme.yaml` for looks) is built into **byte-deterministic, ATS-friendly PDF and DOCX**, plus Markdown and plain text. It is a TypeScript monorepo on npm workspaces, running on Node 24+ (ESM only):

| Path | Package | Role |
| --- | --- | --- |
| `packages/core` | `@cvac/core` | Model, parsing, variants, i18n, themes, layout, PDF/DOCX/Markdown/text renderers, linter. **Isomorphic**: runs in Node and browsers, reads no files |
| `packages/fonts` | `@cvac/fonts` | Bundled Source Sans 3 and Source Serif 4 (OFL) plus a Node loader; `@cvac/fonts/faces` is browser-safe |
| `packages/cli` | `@cvac/cli` | The `cvac` command (commander) |
| `apps/web` | `@cvac/web` | Browser editor: Vite + React + CodeMirror 6 + pdf.js, builds run in a Web Worker |
| `fixtures/` | | Sample CVs for tests, golden hashes (`golden-pdf.json`, `golden-docx.json`) and golden Markdown/text files (`golden-text/`) |

## Commands

```bash
npm install
npm test                                   # vitest, all packages and apps
npx vitest run packages/core/test/pdf.test.ts   # one file
npm run typecheck                          # tsc per workspace
npm run lint                               # biome check, not .md files (npm run format applies fixes)
npm run build                              # core -> fonts -> cli -> web (order matters)
npm run cvac -- lint fixtures/basic/cv.yaml    # CLI from TS sources; cwd is the repo root
npm run web                                # web editor dev server, http://localhost:5173
UPDATE_GOLDEN=1 npm test                   # rewrite golden hashes and golden-text/ files (see Determinism)
npm run e2e                                # Playwright tests of the built web editor (after build)
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs `npm ci`, `lint`, `typecheck`, `build`, `test` and `e2e` on Linux, Windows and macOS. Run the same before declaring work done. It skips pushes that only change `.md` files or `LICENSE`, and a newer push cancels an older run.

**GitHub Pages** ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)) runs after a successful CI run on `main`: it builds the web editor with `CVAC_BASE=<repo>` (served at `/<repo>/`), runs the browser tests against that build and deploys it to https://romanfabio.github.io/cvac/. Test a sub-path build locally with `CVAC_BASE=cvac npm run build -w @cvac/web` then `CVAC_BASE=cvac npm run e2e`.

**End-to-end tests** (`apps/web/e2e/`, config in `apps/web/playwright.config.ts`):

- **What they run against:** `vite preview` of `apps/web/dist` on port 4174, on a desktop and a phone viewport.
- **Browser:** the installed Google Chrome (`channel: "chrome"`), so no Playwright browser download is needed.
- **What they check:**
  - `editor.spec.ts`: the PDF hash (the status bar's `data-sha256`) and every download's hash (DOCX, Markdown, text, through the download menu) equal the CLI's, the download menu works from the keyboard, also for a serif theme and after the theme picker; errors show while editing; edits persist across a reload; fonts load per family; the phone layout has no horizontal scroll
  - `photo.spec.ts`: Add photo writes `basics.photo` into the starter CV and matches the CLI, Remove photo takes it out and deletes the image; photos persist in IndexedDB (including over 4 MB), old `localStorage` photos are migrated, a failed save is reported
  - `project.spec.ts`: the Project menu (Import opens the file picker, Reset asks and restores the starter), import of a zipped folder, and `cvac build` on an unzipped export gives the editor's bytes
  - `csp.spec.ts`: cross-site requests are blocked and normal use causes no CSP violations
  - `site.spec.ts`: the footer's `licenses.txt` lists the fonts and the bundled packages; every request stays inside the base path
- **Navigation:** tests open `./`, never `/`, so they work under a base path (`baseURL` includes `CVAC_BASE`).
- **Helpers** (`e2e/helpers.ts`): `cliHashes()` builds the starter CV with the real CLI in every format (optionally edited, with extra files), `cliBuild(dir)` builds a folder, `downloadAs(page, format)` downloads through the menu on the download button's arrow.

## Pipeline and where code lives

```text
parse (parse/)  ->  resolveVariant (resolve/variant.ts)  ->  resolveLocale (resolve/locale.ts)
                ->  resolveTheme (theme/resolve.ts)       ->  buildLayout (layout/build.ts) -> Layout IR (layout/ir.ts)
                ->  PDF: typeset (render/pdf/typeset.ts) + pdfkit (render/pdf/render.ts)
                ->  DOCX: render/docx/render.ts + normalize.ts (always linear, one column)
                ->  Markdown, text: render/text/render.ts (linear, like the DOCX)
lint (lint/rules.ts) runs on the variant-resolved content, the theme and the PDF page count.
```

Each core module and what it holds:

| Module | Contents |
| --- | --- |
| `model/` | zod schemas: `content.ts`, `theme.ts`, `common.ts` (LocalizedText, dates), `lint.ts` (rule ids). The JSON Schemas are generated from these (`schema.ts`, written to `packages/core/schemas/` by the build) |
| `parse/` | YAML with source spans (`yaml.ts`, `SourceDoc`); semantic checks and `locateDiagnostics` (`index.ts`) |
| `build.ts` | Public entry points `layout()`, `buildPdf()`, `buildDocx()`, `buildMarkdown()`, `buildText()` |
| `editor.ts` | Light entry `@cvac/core/editor`: templates, schemas and types, no renderers (for UI main threads) |
| `templates.ts` | `STARTER_CV` / `STARTER_THEME`, used by `cvac init` and the web editor. They must pass `validate` and `lint` with zero findings in `en` and `it` (tested) |

The CLI (`packages/cli/src`) reads files (`inputs.ts`: the CV, the theme chain including file `extends`, the photo) and calls core.

The web app (`apps/web/src`):

| File | Role |
| --- | --- |
| `App.tsx` | Toolbar, panes, status bar; owns the build worker |
| `Menu.tsx` | `MenuButton`: a WAI-ARIA menu button (keyboard, Escape, outside click, opens on the side with room), optionally split with a main action |
| `DownloadMenu.tsx` | Split download button: PDF, plus a menu with every format. The Project menu (Export, Import, Reset) is a `MenuButton` in `App.tsx` |
| `engine.ts`, `worker.ts` | All core calls (parse, build, lint), in the worker. `engine.ts` is pure and tested in Node; the worker fetches font families on demand |
| `Editor.tsx`, `complete.ts` | CodeMirror 6 with cvac's diagnostics and schema-driven YAML completion |
| `Preview.tsx` | pdf.js rendering of the PDF |
| `themeFile.ts` | Reads and rewrites `extends:` for the theme picker |
| `cvPhoto.ts` | Reads, adds and removes `basics.photo` in the CV text for the photo buttons (block-style `basics:` only) |
| `project.ts` | Project `.zip` export and import |
| `photoStore.ts`, `storage.ts` | Photos in IndexedDB; the YAML and settings in `localStorage` |
| `zodConfig.ts` | zod `jitless` for the CSP; must stay the first import of `main.tsx` |

## Invariants: do not break these

### Determinism (same input + same version = same bytes, in every runtime)

- **No ambient inputs in core:** no `Date.now()`/`new Date()`, no `Math.random`, no `Intl` or locale-dependent formatting, no system fonts, no filesystem. Dates and labels come from `i18n/` tables; the document date defaults to 2000-01-01 (`DEFAULT_DOCUMENT_DATE`).
- **pdfkit:** always use `loadPdfKit()` from `render/pdf/pdfkit.ts`, never `import PDFDocument from "pdfkit"` elsewhere. pdfkit's Node build compresses with Node's zlib (machine- and version-dependent); core loads the fflate browser build in Node too. A test asserts this.
- **DOCX:** the `docx` library emits random relationship ids, current timestamps and process-global counters. `normalize.ts` fixes ids, `core.xml` dates and zip mtimes; the photo uses a fixed drawing id. Anything new that the docx library numbers (images, bookmarks, comments) needs the same treatment.
- **Markdown and text** are strings built from the linear layout, written as UTF-8 without a BOM, `\n` only, one trailing newline, no wrapping. Their goldens are the files in `fixtures/golden-text/` (`text.test.ts`), so a change shows as a readable diff. Escaping (`mdEscape`, `mdLineStart`) must keep every run recoverable: `text.test.ts` strips the Markdown and checks every run in order.
- **Golden hashes** catch any output change. Only run `UPDATE_GOLDEN=1` for an intended change, then check `git diff fixtures/golden-*.json`: exactly the cases you expected should change, and say which ones in the commit message. Refactors must leave every hash unchanged.
- **Cross-runtime:** the web editor's status-bar SHA-256 must equal the CLI's for the same files.

### ATS safety (enforced in the output, tested by `roundtrip.test.ts`)

- **Reading order:** text is emitted in semantic reading order. In PDFs, page layers are emitted background, header, photo, main, sidebar.
- **Line breaks:** break only at whitespace, never inside a token (URLs, emails, `event-driven`); only words wider than a whole line are split by characters.
- **Separators:** runs marked `separator: true` (the " · " between contact items and languages) are decoration. The PDF drops one that would end or start a line; the DOCX binds it to the item before with a no-break space. The round-trip test skips them.
- **DOCX structure:** one column in CV order (`linear: true`), native heading styles and lists, no text boxes, tables or page headers. Contact details stay in the body.
- **Round-trip:** every layout text run must be recoverable, in order, from both formats.

## Conventions

- **TypeScript runs unbuilt in Node** (type stripping), so:
  - Import local files with `.ts` extensions; `rewriteRelativeImportExtensions` turns them into `.js` in builds.
  - `erasableSyntaxOnly` is on: no enums, namespaces or constructor parameter properties.
- **Strict flags:** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Optional fields are added with conditional spreads (`...(x ? { x } : {})`), never by assigning `undefined`.
- **Source condition:** workspace packages export a `source` condition pointing at `src/`. Vitest aliases `@cvac/*` to sources and Vite uses the condition, so tests and dev never hit a stale `dist`. A new entry point needs `source`, `types` and `default` in `exports`.
- **Core stays isomorphic:** no `node:` imports in `packages/core/src`. Node-only code belongs in the CLI or `@cvac/fonts` (`index.ts`).
- **zod:** parse with `safeParse(data, { reportInput: true })`; without it, wrong types look like missing properties. Localized maps parse to `{ $l10n: {...} }`; check them with `isLocalized()`.
- **Theme schema fields** are optional with no schema-level `.default()`, because defaults would override a base theme when themes merge. Defaults live in `resolveTheme`.
- **Diagnostics** (`diagnostics.ts`) have a stable `code`, a `severity`, a `message` and an optional `help`. Ones raised after parsing carry a `path` and an `origin` (`content` or `theme`) and get a location from `locateDiagnostics()`. Paths computed on a variant must be mapped back with `mapDiagnostics()`. Sort with `sortDiagnostics()` before showing them.
- **Messages are written for CV authors:** say what is wrong at which path, and how to fix it in `help`.

### Recipes

- **New content field:**
  1. Add it to the zod schema in `model/content.ts`.
  2. Render it in `layout/build.ts`. Every renderer (PDF, DOCX, Markdown, text) reads the IR, so no renderer change is usually needed.
  3. Add or update a fixture.
  4. Refresh the goldens intentionally.
  5. If it is a free-text field, check that `lint/rules.ts` `texts()` covers it (emoji and glyph checks).
- **New lint rule:**
  1. Add its id to `LINT_RULE_IDS` (`model/lint.ts`).
  2. Implement a `Rule` in `lint/rules.ts`, with a default `level`, a one-line `summary` and findings that have a `path` and a `help`.
  3. Register it in `RULES`.
  4. Add tests in `packages/core/test/lint.test.ts`. A load-time check fails if an id has no implementation.
- **New CLI option:** add it in `packages/cli/src/main.ts` and in the command module; cover it in `packages/cli/test/cli.test.ts`. CLI tests call `main()` in-process with a captured `Io`, inside a temp directory.
- **New theme setting:**
  1. Add it to the schema in `model/theme.ts` (optional, no default).
  2. Resolve it in `theme/resolve.ts`.
  3. Use it in layout and typesetting.
  4. If it can hurt readability, add a lint rule that only flags user-set values.
  5. If the IR gains a field (as `align` and `bar` did), map it in the PDF typesetter and `render/docx/render.ts`. The Markdown and text renderers (`render/text/render.ts`) only need it if it carries text.
- **New built-in theme:**
  1. Add its name to `BUILTIN_THEME_NAMES` (`model/theme.ts`) and its object to `BUILTIN_THEMES` (`theme/resolve.ts`). Built-ins extend `default` and only set what differs. Objects merge, so a built-in cannot remove a base value (for example a sidebar tint): extend `default` instead.
  2. Add golden cases (`fixture+theme` in `pdf.test.ts` and `docx.test.ts`) and a round-trip case.
  3. The `built-in themes` tests in `themes.test.ts` lint every built-in as if all its values were user-set, so it must pass the readability rules.
  4. Update the theme table in the README and the comment in `STARTER_THEME`.
- **New label language:**
  1. Add a `Labels` table in `i18n/labels.ts` (sections, the word for "present", short and long months in the language's usual written form) and list it in `TABLES`.
  2. Add the language's usual section headings to `STANDARD_HEADINGS` in `lint/rules.ts`.
  3. Extend `fixtures/multilingual/cv.yaml` with the language, and add golden and round-trip cases.
  4. `resolve.test.ts` checks every table is complete and that both bundled fonts can draw it.
  5. Update the language table in the README.
- **New bundled font:**
  1. Add the files under `packages/fonts/files/<family>/` with the OFL text.
  2. List the faces in `faces.ts`.
  3. The web worker loads a family only when a theme uses it, and the DOCX embeds only the used families, so other themes' bytes don't change.

## Dependencies

- **Choice:** permissive licenses only (MIT, ISC, Apache-2.0, OFL for fonts), actively maintained. Versions are pinned exactly (`.npmrc` has `save-exact`). Run `npm audit` after adding anything.
- **Installs:** use `npm install <pkg>@<version> --workspace=<path>` and check that the package's `package.json` actually lists it. npm has silently skipped runtime dependencies here before.
- **Known decisions:**
  - pdfkit: browser build everywhere (see Determinism).
  - docx: output normalized afterwards.
  - Web editor: CodeMirror 6, not Monaco. Monaco 0.57's worker API breaks monaco-yaml, so the YAML completion is our own, in `apps/web/src/complete.ts`.
  - QuestPDF and pdf-lib were rejected: QuestPDF's license is revenue-capped, and pdf-lib is unmaintained.

## Pitfalls seen in this repo

- **Line endings:** files must be LF (`.gitattributes` enforces it in git). Python on Windows writes CRLF in text mode; use `open(..., newline="")`. `git ls-files | xargs grep -lU $'\r'` finds offenders.
- **Checking DOCX rendering:** LibreOffice ignored the embedded Source Serif 4 here and substituted other fonts, while Word rendered it correctly. Check font-related DOCX changes in Word (it can be driven read-only through COM from PowerShell: `Documents.Open(path, $false, $true)`, then `ExportAsFixedFormat(pdf, 17)`).
- **CSP and zod:** the built web page has a Content-Security-Policy without `eval` (`apps/web/vite.config.ts`). zod probes `new Function` when a schema is created unless `jitless` is set, which the browser reports as a violation. `apps/web/src/zodConfig.ts` sets it and must stay the first import of `main.tsx`. `e2e/csp.spec.ts` fails on any violation.
- **Project zips** (`apps/web/src/project.ts`) mirror the `cvac init` layout; `e2e/project.spec.ts` checks that `cvac build` on an unzipped export gives the editor's bytes. Paths from a CV or a zip go through `safePath()`, so nothing is written or read outside the project folder (zip-slip).
- **Photos in the web editor** live in IndexedDB (`photoStore.ts`), not `localStorage` (about 5 MB, as text). Never re-encode or resize them in the browser: browser encoders differ, and the bytes would no longer match the CLI.
- **Git Bash path conversion:** on Windows, Git Bash rewrites environment values that start with `/` into Windows paths, so `CVAC_BASE=/cvac/` becomes `/C:/Program Files/Git/cvac/`. Pass `CVAC_BASE=cvac`; the config adds the slashes.
- **Third-party notices:** `apps/web/vite.config.ts` collects every npm package bundled into the page and the worker and writes `dist/licenses.txt`, linked from the footer. A new bundled dependency is listed automatically, but its license must still be permissive (see Dependencies).
- **Web worker lifetime:** create workers inside a `useEffect` and terminate them in its cleanup. React StrictMode runs effects twice in dev.
- **Preview sizing:** don't rely only on `ResizeObserver` or `requestAnimationFrame` for first-paint sizing; measure on mount. Callbacks don't fire in background tabs.
- **YAML completion** works by indentation on possibly-invalid text. Test new cases on realistic documents with several list items (`apps/web/test/complete.test.ts`), not one-liners.
- **Starter templates** contain the `yaml-language-server` modeline pointing at `./.cvac/schemas/`, which `cvac init` and `cvac schema` create.

## Publishing and licensing

- The repository is public at https://github.com/romanfabio/cvac, under the MIT license (`LICENSE`).
- Commits use the author's GitHub noreply address, set in this clone's git config (`user.email`). Never commit with another address.
- Bundled assets: the fonts are Adobe's, unmodified, under the OFL, with `OFL.txt` next to them (keep it there). The fixture photos were drawn by a script for this project; fixture people and companies are made up. Any new asset needs a clear license or must be generated, and the README's License section must list it.
- Never commit personal data, local paths or secrets.

## Roadmap

YAML (`cv.yaml`, `theme.yaml`) is the only input format. A custom CV language was considered and dropped; don't reintroduce it.

- Contact icons, from a permissively licensed icon set.
- npm publishing.
- Moving the web editor from GitHub Pages to a host that can send the CSP as a header (so it also covers the worker).

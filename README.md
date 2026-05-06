# Resume Exporter

Static tooling to turn a Markdown resume (and cover letter) into polished HTML (including HTML email), PDF, and DOCX deliverables.

Purpose: eliminate the tedium of working in Microsoft/Adobe tooling (Word, Acrobat, etc.) for resumes and cover letters by keeping **Markdown as the single source of truth**. This approach improves ATS compatibility (clean, structured text), gives you more flexibility in authoring (versionable, diffable, reusable content), and aims to keep outputs consistent across formats so you don’t have to re-author, convert, or “fix formatting” every time you export.

Original concept: BBaysinger.

At a glance:

- Markdown → HTML via Pandoc, using a repo template + CSS.
- HTML → PDF via WeasyPrint (print CSS controls the PDF look).
- Markdown → DOCX via Pandoc (experimental), then post-processed so Word formatting is more consistent.

## How it works

- **HTML export**: Pandoc converts Markdown to standalone HTML using [converter/pandoc-template.html](converter/pandoc-template.html), applies [converter/resume.css](converter/resume.css), and runs a small Lua filter to tweak formatting (see [converter/filters/align_dates_right.lua](converter/filters/align_dates_right.lua)).
- **PDF export**: The PDF pipeline first generates HTML (same as above), then runs `python -m weasyprint` with [converter/pdf-print.css](converter/pdf-print.css).
- **DOCX export (experimental)**: Pandoc emits DOCX directly from Markdown, then Python scripts normalize list indentation and global typography to keep spacing, margins, and heading styles more predictable:
  - [converter/scripts/normalize_docx_lists.py](converter/scripts/normalize_docx_lists.py)
  - [converter/scripts/normalize_docx_styles.py](converter/scripts/normalize_docx_styles.py)

  DOCX is inherently less CSS-like than HTML/PDF; the pipeline focuses on preserving content and structure and then normalizing common formatting pitfalls so the resulting document is stable and predictable across Word versions.

## Requirements

- Node.js 18+ (runs the repo scripts)
- Python 3.10+ (PDF + DOCX normalizers)
- Pandoc on your `PATH`

For PDF export you also need WeasyPrint available to your Python environment.

### macOS notes (WeasyPrint)

WeasyPrint depends on system libraries (Cairo/Pango/etc). If `pip install weasyprint` fails or PDF export errors at runtime, installing dependencies via Homebrew typically resolves it:

```bash
brew install pandoc
brew install weasyprint
```

If you prefer a Python-only install, you may still need Homebrew libs; consult the WeasyPrint docs for the latest native dependency list.

## Setup

```bash
npm install

python3 -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install weasyprint
```

The Node scripts will use `.venv/bin/python` automatically if it exists; otherwise they fall back to `python3`.

### Git hooks (recommended)

To avoid accidentally committing private resume content under `input/` to this repo, install the repo hooks:

```bash
bash scripts/input/_scripts/setup-hooks.sh
```

## Quick start

Convert everything under `input/` (most common):

```bash
npm run convert:all
```

Convert a single input file:

```bash
npm run export:pdf -- --input "input/General.md"
npm run export:docx -- --input "input/General.md"
npm run build:html  -- --input "input/General.md"
```

Outputs are written to `output/` by default. Output basenames are derived from the input filename (spaces become underscores; special characters are stripped).

## Commands

All commands accept `--help` style flags via standard `--key value` / `--key=value` parsing.

### `npm run build:html`

Build a standalone HTML file.

Common flags:

- `--input` (required): path to a Markdown file
- `--outputDir`: directory for generated files (default: `output/`)
- `--html` / `--output`: explicit HTML output path (overrides `--outputDir`)
- `--css`: CSS file path (default: `converter/resume.css`)
- `--template`: Pandoc HTML template (default: `converter/pandoc-template.html`)
- `--alignDatesFilter`: Lua filter path (default: `converter/filters/align_dates_right.lua`)

### `npm run export:pdf`

Generate PDF using WeasyPrint (HTML is generated as an intermediate artifact).

Common flags:

- `--input` (required)
- `--outputDir` (default: `output/`)
- `--pdf`: explicit PDF output path
- `--html`: explicit intermediate HTML path
- `--printCss`: print stylesheet (default: `converter/pdf-print.css`)

### `npm run export:docx` (experimental)

Generate a Word document.

Note: DOCX layout can still vary somewhat across Word versions and settings; for a locked visual result, prefer PDF.

Common flags:

- `--input` (required)
- `--outputDir` (default: `output/`)
- `--docx`: explicit DOCX output path

### `npm run convert:all`

Batch convert every `*.md` found under `input/`.

Note: `input/Resume-TEMPLATE.stub.md` is treated as a non-convertible template and is skipped by `convert:all`.
If you want to render it anyway, use a single-file command (e.g. `npm run build:html -- --input "input/Resume-TEMPLATE.stub.md"`).

```bash
npm run convert:all
npm run convert:all -- --formats pdf,docx,html
npm run convert:all -- --formats docx,html
npm run convert:all -- --continueOnError
```

Flags:

- `--contentDir`: directory to scan (default: `input/`)
- `--outputDir`: output directory (default: `output/`)
- `--formats`: comma-separated list from `pdf,docx,html` (default: `pdf,docx,html`)
- `--continueOnError`: keep going if a file fails

Notes:

- Underscore-prefixed directories (like `input/_archive/`) are treated as non-content and are skipped.
- If `pdf` is in `--formats`, HTML is generated as part of the PDF pipeline.

### `npm run draft:email` (experimental)

Creates a local email draft file (`.eml`) using a cover letter as the HTML body and a resume PDF as an attachment.

- The script inlines CSS into a `<style>` tag (more email-client friendly than stylesheet links).
- Local images referenced in the cover letter HTML are converted into **CID inline attachments** and rewritten as `cid:...` image URLs.
- It does **not** send email; it only writes an `.eml` you can import into Apple Mail / Outlook / Gmail (via “attach as file” workflows).

Examples:

```bash
npm run draft:email -- \
  --cover "input/Codespeed-Front-End-Developer-Cover.md" \
  --resume "input/Codespeed-Front-End-Developer.md" \
  --to "hiring@example.com" \
  --subject "Front End Developer Application"
```

If you already have the PDF:

```bash
npm run draft:email -- \
  --cover "input/Codespeed-Front-End-Developer-Cover.md" \
  --resumePdf "output/Codespeed-Front-End-Developer.pdf"
```

Using the tracked lorem example inputs:

```bash
npm run draft:email -- \
  --cover "input/CoverLetter-EXAMPLE.lorem.md" \
  --resume "input/Resume-EXAMPLE.lorem.md" \
  --to "hiring@example.com" \
  --subject "Front-End Engineer Application"
```

Starter-state note: email HTML rendering varies a lot between clients. Expect to iterate on markup/CSS for your target client(s).

## Repo layout

- [input/](input/) — source Markdown resumes/cover letters (this folder is its own git repo; ignored by this repo’s `.gitignore`).
- [output/](output/) — generated artifacts (safe to delete/regenerate).
- [examples/](examples/) — tracked templates/examples you can copy into `input/`:
  - [examples/Resume-TEMPLATE.stub.md](examples/Resume-TEMPLATE.stub.md)
  - [examples/Resume-EXAMPLE.lorem.md](examples/Resume-EXAMPLE.lorem.md)
  - [examples/CoverLetter-TEMPLATE.stub.md](examples/CoverLetter-TEMPLATE.stub.md)
  - [examples/CoverLetter-EXAMPLE.lorem.md](examples/CoverLetter-EXAMPLE.lorem.md)
- [converter/](converter/) — Pandoc template, CSS, Lua filters, and DOCX normalization scripts.
- [scripts/](scripts/) — Node entrypoints for single-file and batch conversions.

## Private `input/` repo (how it works)

This repo intentionally treats `input/` as a **separate git repo** so you can version your real resumes/cover letters locally (or in a private remote) without ever committing them to this tooling repo or pushing them to GitHub.

- The parent repo ignores `input/` via `.gitignore`, so your private files won’t show up in the parent repo’s `git status`.
- If you want version history, commit inside `input/`:

```bash
cd input
git status
git add .
git commit -m "Update resume"
```

If you don’t want anything uploaded anywhere, simply don’t add a remote in `input/` (or only add a private one).

Tip: install hooks via `npm run setup:input-hooks` (or `bash scripts/input/_scripts/setup-hooks.sh`) so commits in `input/` get the Markdown normalizer automatically.

## Markdown authoring conventions

This repo leans on a few Pandoc-friendly conventions to keep output consistent.

### Headings + right-aligned date ranges

The Lua filter [converter/filters/align_dates_right.lua](converter/filters/align_dates_right.lua) will right-align date ranges **only** when:

- The heading is an `H2` or `H3` (`##` or `###`), and
- The _very next paragraph_ is a date-only paragraph that contains exactly one emphasized or bold span (i.e. `_[ 2021 – 2024 ]_` or `**2021-2024**`), and
- The text contains at least one digit and a dash (`-` or `–`).

Example pattern:

```md
### Company — Role (Remote)

_[ 2021 – 2024 ]_
```

Notes:

- The date line must be its own paragraph and must not include extra text outside the emphasis/bold.
- This is used heavily in `EXPERIENCE` sections to keep dates visually aligned.

### Name styling (optional)

If you want the first/last name colors from the CSS, write the H1 using inline HTML spans:

```md
# <span class="name-first">FIRST</span> <span class="name-last">LAST</span>
```

Pandoc will preserve these spans in HTML/PDF output.

### Contact blocks and line breaks

For tight contact blocks, use Markdown hard line breaks (two trailing spaces) rather than separate paragraphs:

```md
**Email:** you@example.com  
**LinkedIn:** https://linkedin.com/in/you
```

### Spacing tweaks

You’ll see occasional raw HTML like `<br><br><br>` in existing inputs to force page breaks/spacing in HTML/PDF. Pandoc passes this through; use sparingly.

## Preventing “invisible” diff noise in input Markdown

Copy/paste from Word/Google Docs can introduce invisible or lookalike Unicode characters (notably the non-breaking hyphen `U+2011`) that render like `-` but create noisy diffs.

This repo includes a normalizer plus an optional pre-commit hook for the nested `input/` git repo:

- Normalize manually:
  - `npm run normalize:md` (rewrites files under `input/`)
  - `npm run normalize:md:check` (fails if fixes would be applied)
- Install the hook (recommended if you commit within `input/`):
  - `npm run setup:input-hooks`

The hook normalizes staged `*.md` files and (if available) formats them with the parent repo’s Prettier config.

## Formatting

- Format all files supported by this repo’s Prettier setup: `npm run format`
- Check formatting without writing: `npm run format:check`
- Format only Markdown under `input/`: `npm run format:md`
- Check Markdown formatting: `npm run format:md:check`

## Troubleshooting

- **`pandoc: command not found`**: install Pandoc and ensure it’s on your `PATH` (macOS: `brew install pandoc`).
- **WeasyPrint import/runtime errors**: confirm your active Python is the one with WeasyPrint installed (the scripts prefer `.venv/`). On macOS, `brew install weasyprint` is the quickest way to get native dependencies.

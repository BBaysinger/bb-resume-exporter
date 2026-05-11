#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token.startsWith("--")) {
      const [rawKey, rawValue] = token.split("=", 2);
      const key = rawKey.slice(2);

      if (rawValue !== undefined) {
        args[key] = rawValue;
        continue;
      }

      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }

      continue;
    }

    args._.push(token);
  }

  return args;
}

function sanitizeBasename(name) {
  return name
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/_+/g, "_");
}

function resolveDefaultOutputs({ input, outputDir }) {
  const inputBase = path.basename(input, path.extname(input));
  const safeBase = sanitizeBasename(inputBase);

  const html = path.join(outputDir, `${safeBase}.html`);
  const pdf = path.join(outputDir, `${safeBase}.pdf`);
  const docx = path.join(outputDir, `${safeBase}.docx`);

  return { html, pdf, docx };
}

function run(command, commandArgs, { cwd } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
  });

  if (result.error) {
    fail(`Failed running ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getVenvPython(baseDir) {
  const venvPython = path.join(baseDir, ".venv", "bin", "python");
  return fileExists(venvPython) ? venvPython : "python3";
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function buildPandocResourcePath(...pathsToInclude) {
  return [
    ...new Set(
      pathsToInclude.filter(Boolean).map((entry) => path.resolve(entry)),
    ),
  ].join(path.delimiter);
}

function usage() {
  const cmd = path.basename(process.argv[1]);
  console.log(`Usage:
  ${cmd} build-html   --input <markdown> [--output <html>] [--css <css>]
  ${cmd} export-pdf   --input <markdown> [--pdf <pdf>] [--html <html>] [--css <css>] [--printCss <css>]
  ${cmd} export-docx  --input <markdown> [--docx <docx>]

Examples:
  npm run build:html -- --input "input/resume.md"
  npm run export:pdf -- --input "input/resume.md"
  npm run export:docx -- --input "input/resume.md"
`);
}

const [, , command, ...rest] = process.argv;
const args = parseArgs(rest);

if (!command || args.help) {
  usage();
  process.exit(command ? 0 : 1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const input = args.input ?? args.in ?? args._[0];
if (!input) {
  usage();
  fail("Missing --input <markdown>");
}

const outputDir = args.outputDir ?? path.join(repoRoot, "output");
ensureDir(outputDir);

const defaults = resolveDefaultOutputs({ input, outputDir });

const css = args.css ?? path.join(repoRoot, "converter", "resume.css");
const printCss =
  args.printCss ?? path.join(repoRoot, "converter", "pdf-print.css");
const template =
  args.template ?? path.join(repoRoot, "converter", "pandoc-template.html");
const alignDatesFilter =
  args.alignDatesFilter ??
  path.join(repoRoot, "converter", "filters", "align_dates_right.lua");

const html = args.output ?? args.html ?? defaults.html;
const pdf = args.pdf ?? defaults.pdf;
const docx = args.docx ?? defaults.docx;

if (command === "build-html") {
  const resourcePath = buildPandocResourcePath(path.dirname(input), repoRoot);
  run("pandoc", [
    "--standalone",
    "--embed-resources",
    "--resource-path",
    resourcePath,
    "--template",
    template,
    "--lua-filter",
    alignDatesFilter,
    "--css",
    css,
    input,
    "-o",
    html,
  ]);
  process.exit(0);
}

if (command === "export-pdf") {
  run(process.execPath, [
    process.argv[1],
    "build-html",
    "--input",
    input,
    "--html",
    html,
    "--css",
    css,
  ]);

  const python = getVenvPython(repoRoot);
  run(python, ["-m", "weasyprint", html, pdf, "--stylesheet", printCss]);
  process.exit(0);
}

if (command === "export-docx") {
  // Convert directly from Markdown to DOCX. Pandoc does not reliably apply
  // external CSS during HTML->DOCX conversion, so we normalize DOCX styles
  // after conversion to approximate the converter CSS.
  const resourcePath = buildPandocResourcePath(path.dirname(input), repoRoot);
  run("pandoc", [
    "--standalone",
    "--resource-path",
    resourcePath,
    input,
    "-o",
    docx,
  ]);

  const python = getVenvPython(repoRoot);
  const normalizer = path.join(
    repoRoot,
    "converter",
    "scripts",
    "normalize_docx_lists.py",
  );
  if (fileExists(normalizer)) {
    run(python, [normalizer, docx]);
  }

  const styleNormalizer = path.join(
    repoRoot,
    "converter",
    "scripts",
    "normalize_docx_styles.py",
  );
  if (fileExists(styleNormalizer)) {
    run(python, [styleNormalizer, docx]);
  }

  process.exit(0);
}

usage();
fail(`Unknown command: ${command}`);

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

function usage() {
  const cmd = path.basename(process.argv[1]);
  console.log(`Usage:
  ${cmd} [--contentDir <dir>] [--outputDir <dir>] [--formats <csv>] [--continueOnError] [--changedSince <git-ref>]

Defaults:
  --contentDir input
  --outputDir  output
  --formats    pdf,docx,html

Examples:
  npm run convert:all
  npm run convert:changed
  node scripts/convert-all.mjs --formats pdf
  node scripts/convert-all.mjs --changedSince HEAD
  node scripts/convert-all.mjs --contentDir input --outputDir output
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    // Treat underscore-prefixed folders as non-content (e.g., helper scripts)
    if (entry.isDirectory() && entry.name.startsWith("_")) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.startsWith("_")) {
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function runNode(scriptPath, scriptArgs) {
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.status !== 0) {
    const code = result.status ?? 1;
    const err = new Error(`Command failed with exit code ${code}`);
    // @ts-ignore
    err.exitCode = code;
    throw err;
  }
}

function runGit(contentDir, gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: contentDir,
    encoding: "utf8",
  });

  if (result.error) {
    fail(`Failed running git in ${contentDir}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = result.stderr?.trim() || result.stdout?.trim();
    fail(
      `Git command failed in ${contentDir}: git ${gitArgs.join(" ")}${details ? `\n${details}` : ""}`,
    );
  }

  return result.stdout.trim();
}

function listChangedMarkdownFiles(contentDir, gitRef) {
  runGit(contentDir, ["rev-parse", "--show-toplevel"]);

  const trackedOutput = runGit(contentDir, [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    gitRef,
    "--",
    "*.md",
  ]);
  const untrackedOutput = runGit(contentDir, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    "*.md",
  ]);

  return new Set(
    [...trackedOutput.split(/\r?\n/), ...untrackedOutput.split(/\r?\n/)]
      .map((filePath) => filePath.trim())
      .filter(Boolean)
      .map((filePath) => path.resolve(contentDir, filePath)),
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const contentDir = path.resolve(repoRoot, String(args.contentDir ?? "input"));
const outputDir = path.resolve(repoRoot, String(args.outputDir ?? "output"));
const formats = String(args.formats ?? "pdf,docx,html")
  .split(",")
  .map((f) => f.trim().toLowerCase())
  .filter(Boolean);
const changedSince =
  args.changedSince === true ? "HEAD" : args.changedSince || null;

const continueOnError = Boolean(args.continueOnError);

if (!fs.existsSync(contentDir)) {
  fail(`Input directory not found: ${contentDir}`);
}

ensureDir(outputDir);

const SKIP_BASENAMES = new Set([
  "Resume-TEMPLATE.stub.md",
  "CoverLetter-TEMPLATE.stub.md",
]);
const allMdFiles = listMarkdownFiles(contentDir)
  .filter((filePath) => !SKIP_BASENAMES.has(path.basename(filePath)))
  .sort();

if (allMdFiles.length === 0) {
  fail(`No .md files found under: ${contentDir}`);
}

const changedFiles = changedSince
  ? listChangedMarkdownFiles(contentDir, String(changedSince))
  : null;
const mdFiles = changedFiles
  ? allMdFiles.filter((filePath) => changedFiles.has(filePath))
  : allMdFiles;

if (mdFiles.length === 0) {
  if (changedSince) {
    console.log(
      `No changed .md files found under ${path.relative(repoRoot, contentDir) || path.basename(contentDir)} since ${changedSince}.`,
    );
    process.exit(0);
  }

  fail(`No .md files found under: ${contentDir}`);
}

const resumeScript = path.join(repoRoot, "scripts", "resume.mjs");
if (!fs.existsSync(resumeScript)) {
  fail(`Missing converter script: ${resumeScript}`);
}

const wantsPdf = formats.includes("pdf");
const wantsDocx = formats.includes("docx");
const wantsHtml = formats.includes("html");
// Note: PDF export always generates an intermediate HTML file (via resume.mjs),
// so we only need to explicitly build HTML when PDF is not requested.
const shouldBuildHtml = wantsHtml && !wantsPdf;

let failures = 0;

for (const filePath of mdFiles) {
  const relative = path.relative(repoRoot, filePath);
  console.log(`\n==> Converting: ${relative}`);

  try {
    if (wantsPdf) {
      runNode(resumeScript, [
        "export-pdf",
        "--input",
        filePath,
        "--outputDir",
        outputDir,
      ]);
    }

    if (wantsDocx) {
      runNode(resumeScript, [
        "export-docx",
        "--input",
        filePath,
        "--outputDir",
        outputDir,
      ]);
    }

    // If the user asked for HTML (and not PDF), generate it explicitly.
    // DOCX export does not produce HTML, and PDF export already generates HTML.
    if (shouldBuildHtml) {
      runNode(resumeScript, [
        "build-html",
        "--input",
        filePath,
        "--outputDir",
        outputDir,
      ]);
    }
  } catch (error) {
    failures += 1;
    console.error(`Failed converting ${relative}: ${error?.message ?? error}`);

    if (!continueOnError) {
      process.exit(1);
    }
  }
}

if (failures > 0) {
  console.error(`\nCompleted with ${failures} failure(s).`);
  process.exit(1);
}

console.log(
  `\nDone. Converted ${mdFiles.length} file(s) into ${path.relative(repoRoot, outputDir)}/.${changedSince ? ` Filter: changed since ${changedSince}.` : ""}`,
);

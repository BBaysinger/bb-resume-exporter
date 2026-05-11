#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function buildPandocResourcePath(...pathsToInclude) {
  return [
    ...new Set(
      pathsToInclude.filter(Boolean).map((entry) => path.resolve(entry)),
    ),
  ].join(path.delimiter);
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

function usage() {
  const cmd = path.basename(process.argv[1]);
  console.log(`Usage:
  ${cmd} --cover <cover.md> [--resume <resume.md> | --resumePdf <resume.pdf>] [--out <draft.eml>] [--to <email>] [--from <email>] [--subject <text>]

What it does:
  - Builds an HTML email body from the cover letter Markdown.
  - Inlines CSS into <style> (email-friendly) and embeds local images as CID attachments.
  - Attaches the resume PDF (generates it from --resume Markdown unless you pass --resumePdf).

Examples:
  npm run draft:email -- --cover "input/Codespeed-Front-End-Developer-Cover.md" --resume "input/Codespeed-Front-End-Developer.md"
  npm run draft:email -- --cover input/Some-Cover.md --resumePdf output/Some-Resume.pdf --to hiring@example.com --subject "Application"

Notes:
  This is intentionally a starter script. Expect to tweak HTML/CSS for specific email clients.
`);
}

function wrapBase64(base64, lineLen = 76) {
  const lines = [];
  for (let i = 0; i < base64.length; i += lineLen) {
    lines.push(base64.slice(i, i + lineLen));
  }
  return lines.join("\r\n");
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function inlineCss(html, cssText) {
  const styleTag = `<style type="text/css">\n${cssText}\n</style>`;

  // Drop stylesheet links (Pandoc template emits <link rel="stylesheet" ... />).
  const withoutLinks = html.replace(
    /\s*<link\s+[^>]*rel=["']stylesheet["'][^>]*>\s*/gi,
    "\n",
  );

  // Insert style tag before </head> (or after <head> as a fallback).
  if (withoutLinks.includes("</head>")) {
    return withoutLinks.replace("</head>", `${styleTag}\n</head>`);
  }

  if (withoutLinks.includes("<head>")) {
    return withoutLinks.replace("<head>", `<head>\n${styleTag}`);
  }

  return `${styleTag}\n${withoutLinks}`;
}

function extractAndEmbedImages(html, { baseDir, cidDomain }) {
  const attachments = [];

  // Very small/targeted img tag src replacer. This is not a full HTML parser.
  // It’s good enough for Pandoc output and simple hand-authored HTML.
  const imgTagRegex = /<img\b[^>]*\bsrc\s*=\s*("([^"]+)"|'([^']+)')/gi;

  const rewrittenHtml = html.replace(imgTagRegex, (match, quoted, d1, d2) => {
    const src = d1 ?? d2 ?? "";
    const trimmed = src.trim();

    if (!trimmed) return match;
    if (/^(https?:|data:|cid:)/i.test(trimmed)) {
      return match;
    }

    let imgPath = trimmed;
    if (trimmed.startsWith("file://")) {
      imgPath = fileURLToPath(trimmed);
    } else if (!path.isAbsolute(trimmed)) {
      imgPath = path.resolve(baseDir, trimmed);
    }

    if (!fileExists(imgPath)) {
      // Leave as-is; caller can decide if they want to fail hard.
      return match;
    }

    const cid = `${crypto.randomUUID()}@${cidDomain}`;
    const contentType = guessContentType(imgPath);
    const filename = path.basename(imgPath);
    const data = fs.readFileSync(imgPath);

    attachments.push({
      cid,
      filename,
      contentType,
      data,
      disposition: "inline",
    });

    const replacement = match.replace(quoted, `"cid:${cid}"`);
    return replacement;
  });

  return { html: rewrittenHtml, attachments };
}

function buildPandocHtml({
  inputMd,
  outputHtml,
  template,
  css,
  alignDatesFilter,
  repoRoot,
}) {
  const resourcePath = buildPandocResourcePath(path.dirname(inputMd), repoRoot);
  const args = [
    "--standalone",
    "--resource-path",
    resourcePath,
    "--template",
    template,
    "--css",
    css,
    inputMd,
    "-o",
    outputHtml,
  ];

  if (alignDatesFilter && fileExists(alignDatesFilter)) {
    args.splice(4, 0, "--lua-filter", alignDatesFilter);
  }

  run("pandoc", args);
}

function buildResumePdf({ resumeMd, outputPdf, resumeScript, outputDir }) {
  run(process.execPath, [
    resumeScript,
    "export-pdf",
    "--input",
    resumeMd,
    "--pdf",
    outputPdf,
    "--outputDir",
    outputDir,
  ]);
}

function formatDateHeader(date = new Date()) {
  // RFC 5322 date, using JS built-in formatting (close enough for drafts).
  return date.toUTCString().replace("GMT", "+0000");
}

function makeBoundary(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function toEml({
  from,
  to,
  subject,
  html,
  plainText,
  relatedAttachments,
  fileAttachments,
}) {
  const outer = makeBoundary("mixed");
  const related = makeBoundary("related");
  const alt = makeBoundary("alt");

  const lines = [];

  lines.push(`From: ${from}`);
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${subject}`);
  lines.push(`Date: ${formatDateHeader()}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/mixed; boundary="${outer}"`);
  lines.push("");

  // multipart/related (html + inline images)
  lines.push(`--${outer}`);
  lines.push(`Content-Type: multipart/related; boundary="${related}"`);
  lines.push("");

  // multipart/alternative (plain + html)
  lines.push(`--${related}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
  lines.push("");

  // text/plain
  lines.push(`--${alt}`);
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("Content-Transfer-Encoding: 7bit");
  lines.push("");
  lines.push(plainText);
  lines.push("");

  // text/html
  lines.push(`--${alt}`);
  lines.push("Content-Type: text/html; charset=utf-8");
  lines.push("Content-Transfer-Encoding: 7bit");
  lines.push("");
  lines.push(html);
  lines.push("");

  lines.push(`--${alt}--`);
  lines.push("");

  // Inline images
  for (const att of relatedAttachments) {
    const base64 = wrapBase64(att.data.toString("base64"));
    lines.push(`--${related}`);
    lines.push(`Content-Type: ${att.contentType}; name="${att.filename}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(`Content-ID: <${att.cid}>`);
    lines.push(`Content-Disposition: inline; filename="${att.filename}"`);
    lines.push("");
    lines.push(base64);
    lines.push("");
  }

  lines.push(`--${related}--`);
  lines.push("");

  // File attachments (e.g. PDF)
  for (const att of fileAttachments) {
    const base64 = wrapBase64(att.data.toString("base64"));
    lines.push(`--${outer}`);
    lines.push(`Content-Type: ${att.contentType}; name="${att.filename}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
    lines.push("");
    lines.push(base64);
    lines.push("");
  }

  lines.push(`--${outer}--`);
  lines.push("");

  return lines.join("\r\n");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const coverMd = args.cover ?? args.coverLetter;
const resumeMd = args.resume;
const resumePdfArg = args.resumePdf;

if (!coverMd) {
  usage();
  fail("Missing --cover <cover.md>");
}

if (!resumeMd && !resumePdfArg) {
  usage();
  fail("Provide either --resume <resume.md> or --resumePdf <resume.pdf>");
}

const outputDir = path.resolve(repoRoot, String(args.outputDir ?? "output"));
ensureDir(outputDir);

const coverBase = sanitizeBasename(
  path.basename(coverMd, path.extname(coverMd)),
);

const outPath = path.resolve(
  repoRoot,
  String(args.out ?? args.output ?? path.join(outputDir, `${coverBase}.eml`)),
);

const tmpDir = path.join(outputDir, "_email_tmp");
ensureDir(tmpDir);

const coverHtmlPath = path.join(tmpDir, `${coverBase}.cover.html`);

const template =
  args.template ?? path.join(repoRoot, "converter", "pandoc-template.html");
const css = args.css ?? path.join(repoRoot, "converter", "resume.css");
const alignDatesFilter =
  args.alignDatesFilter ??
  path.join(repoRoot, "converter", "filters", "align_dates_right.lua");

const resumeScript = path.join(repoRoot, "scripts", "resume.mjs");

// Step 1: Build cover letter HTML via Pandoc.
buildPandocHtml({
  inputMd: coverMd,
  outputHtml: coverHtmlPath,
  template,
  css,
  alignDatesFilter,
  repoRoot,
});

let coverHtml = fs.readFileSync(coverHtmlPath, "utf-8");

// Step 2: Inline CSS for email clients.
const cssText = fs.readFileSync(css, "utf-8");
coverHtml = inlineCss(coverHtml, cssText);

// Step 3: Embed local images as CID attachments.
const coverDir = path.dirname(path.resolve(repoRoot, coverMd));
const { html: embeddedHtml, attachments: inlineImages } = extractAndEmbedImages(
  coverHtml,
  {
    baseDir: coverDir,
    cidDomain: "resume-generator.local",
  },
);

// Step 4: Ensure we have a resume PDF.
let resumePdfPath = resumePdfArg;
if (!resumePdfPath && resumeMd) {
  const resumeBase = sanitizeBasename(
    path.basename(resumeMd, path.extname(resumeMd)),
  );
  resumePdfPath = path.join(outputDir, `${resumeBase}.pdf`);
  buildResumePdf({
    resumeMd,
    outputPdf: resumePdfPath,
    resumeScript,
    outputDir,
  });
}

if (!resumePdfPath) {
  fail("Unable to resolve resume PDF path");
}

const resumePdfAbs = path.resolve(repoRoot, resumePdfPath);
if (!fileExists(resumePdfAbs)) {
  fail(`Resume PDF not found: ${resumePdfAbs}`);
}

const from = args.from ?? "you@example.com";
const to = args.to ?? "recipient@example.com";
const subject = args.subject ?? "Job Application";

const plainText =
  args.plainText ??
  "(HTML cover letter attached as this email body; resume PDF attached.)";

const fileAttachments = [
  {
    filename: path.basename(resumePdfAbs),
    contentType: guessContentType(resumePdfAbs),
    data: fs.readFileSync(resumePdfAbs),
  },
];

const eml = toEml({
  from,
  to,
  subject,
  html: embeddedHtml,
  plainText,
  relatedAttachments: inlineImages,
  fileAttachments,
});

fs.writeFileSync(outPath, eml, "utf-8");

console.log(`\nWrote email draft: ${path.relative(repoRoot, outPath)}`);
if (inlineImages.length > 0) {
  console.log(`Embedded inline images: ${inlineImages.length}`);
}
console.log(
  "Note: This is an experimental starter draft; expect to tweak HTML/CSS per email client.",
);

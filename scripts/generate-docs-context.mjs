#!/usr/bin/env node
/**
 * Mintlify docs context generator (from docs.json navigation).
 *
 * Outputs (build mode):
 *  - <OUT_DIR>/00-index.md
 *  - <OUT_DIR>/01-guias.md
 *  - <OUT_DIR>/02-api-reference.md
 *  - <OUT_DIR>/03-openapi.md
 *
 * Outputs (list mode):
 *  - --list      => <OUT_DIR>/FILES.md
 *  - --list-all  => <OUT_DIR>/FILES_ALL.txt + <OUT_DIR>/FILES_ALL.md
 *
 * Usage:
 *   node scripts/generate-docs-context.mjs
 *   node scripts/generate-docs-context.mjs --list
 *   node scripts/generate-docs-context.mjs --list-all
 *   node scripts/generate-docs-context.mjs --list --list-all
 *
 * Optional env vars:
 *   OUT_DIR=context
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = process.cwd();
const OUT_DIR = process.env.OUT_DIR ?? "context";

const args = new Set(process.argv.slice(2));
const LIST_MODE = args.has("--list");
const LIST_ALL_MODE = args.has("--list-all");
const ANY_LIST_MODE = LIST_MODE || LIST_ALL_MODE;

// Ignore directories anywhere
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "trash",
  "images",
  "logo",
  ".next",
  "dist",
  "build",
]);

function normalizeSlashes(p) {
  return p.replaceAll("\\", "/");
}

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function ensureDir(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readFile(absPath) {
  return fs.readFileSync(absPath, "utf8");
}

function exists(absPath) {
  return fs.existsSync(absPath);
}

function fenceLangFor(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".md" || ext === ".mdx") return "md";
  if (ext === ".json") return "json";
  return "";
}

function isExcludedPath(relPath) {
  const parts = normalizeSlashes(relPath).split("/");
  return parts.some((p) => EXCLUDED_DIRS.has(p));
}

/**
 * Resolve a Mintlify page id to an actual file.
 * Example page: "campaigns/message" -> "campaigns/message.mdx" or ".md"
 * Special case: "index" -> "index.mdx"
 */
function resolvePageToFile(pageId) {
  const candidates = [
    path.join(repoRoot, `${pageId}.mdx`),
    path.join(repoRoot, `${pageId}.md`),
  ];

  for (const abs of candidates) {
    if (exists(abs)) {
      const rel = normalizeSlashes(path.relative(repoRoot, abs));
      return { abs, rel };
    }
  }

  return null;
}

function resolveOpenApi(openapiPath) {
  // openapi in docs.json is like "/api-reference/openapi.json"
  const cleaned = openapiPath.startsWith("/")
    ? openapiPath.slice(1)
    : openapiPath;

  const abs = path.join(repoRoot, cleaned);
  if (!exists(abs)) return null;

  const rel = normalizeSlashes(path.relative(repoRoot, abs));
  return { abs, rel };
}

function renderBundleMarkdown({ title, generatedAt, items }) {
  // items: Array<{ rel, abs, kind: "page" | "asset", label?: string }>
  const lines = [];

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Generated: \`${generatedAt}\``);
  lines.push("");
  lines.push(
    `Excluded directories (any depth): ${[...EXCLUDED_DIRS]
      .map((d) => `\`${d}\``)
      .join(", ")}`
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## Table of contents");
  lines.push("");

  for (const it of items) {
    const anchor = `file-${sha1(it.rel).slice(0, 12)}`;
    const prefix = it.kind === "page" ? "📄" : "🧩";
    lines.push(`- ${prefix} [\`${it.rel}\`](#${anchor})`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  for (const it of items) {
    const anchor = `file-${sha1(it.rel).slice(0, 12)}`;
    const lang = fenceLangFor(it.rel);
    const content = readFile(it.abs).replace(/\s+$/g, "");

    lines.push(`## \`${it.rel}\``);
    lines.push(`<a id="${anchor}"></a>`);
    lines.push("");
    lines.push("```" + lang);
    lines.push(content);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function renderIndex({ generatedAt, bundles, docsJsonPath }) {
  const lines = [];
  lines.push("# Docs Context Index");
  lines.push("");
  lines.push(`Generated: \`${generatedAt}\``);
  lines.push("");
  lines.push(`Source of truth: \`${docsJsonPath}\``);
  lines.push("");
  lines.push("## Files");
  lines.push("");
  for (const b of bundles) {
    lines.push(`- [${b.title}](${b.filename})`);
  }
  lines.push("");
  lines.push("## How this was built");
  lines.push("");
  lines.push("- Pages are selected from `docs.json.navigation.tabs[].groups[].pages`.");
  lines.push("- Each page id is resolved to `<id>.mdx` (fallback `<id>.md`).");
  lines.push("- Images are not embedded (folders `images/` and `logo/` are ignored).");
  lines.push("");
  return lines.join("\n");
}

function formatKB(bytes) {
  const kb = bytes / 1024;
  if (kb < 10) return `${kb.toFixed(2)} KB`;
  if (kb < 100) return `${kb.toFixed(1)} KB`;
  return `${Math.round(kb)} KB`;
}

function renderFilesManifest({ generatedAt, sections }) {
  // sections: Array<{ id, title, files: Array<{rel, size}> }>
  const lines = [];
  lines.push("# Files manifest");
  lines.push("");
  lines.push(`Generated: \`${generatedAt}\``);
  lines.push("");
  lines.push(
    `Excluded directories (any depth): ${[...EXCLUDED_DIRS]
      .map((d) => `\`${d}\``)
      .join(", ")}`
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  let totalFiles = 0;
  let totalBytes = 0;

  const all = [];

  for (const s of sections) {
    totalFiles += s.files.length;
    const bytes = s.files.reduce((acc, f) => acc + f.size, 0);
    totalBytes += bytes;

    for (const f of s.files) {
      all.push({ rel: f.rel, size: f.size, section: s.title });
    }
  }

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total files: **${totalFiles}**`);
  lines.push(`- Total size: **${formatKB(totalBytes)}**`);
  lines.push("");

  for (const s of sections) {
    const bytes = s.files.reduce((acc, f) => acc + f.size, 0);
    lines.push(`## ${s.id} ${s.title}`);
    lines.push("");
    lines.push(`- Files: **${s.files.length}**`);
    lines.push(`- Size: **${formatKB(bytes)}**`);
    lines.push("");
    for (const f of s.files) {
      lines.push(`- \`${f.rel}\` — ${formatKB(f.size)}`);
    }
    lines.push("");
  }

  all.sort((a, b) => b.size - a.size);
  const top = all.slice(0, 20);

  lines.push("---");
  lines.push("");
  lines.push("## Top 20 largest files");
  lines.push("");
  for (const f of top) {
    lines.push(`- \`${f.rel}\` — ${formatKB(f.size)} *(from ${f.section})*`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderFilesAllMarkdown({ generatedAt, allFiles }) {
  const lines = [];
  lines.push("# Files (raw list)");
  lines.push("");
  lines.push(`Generated: \`${generatedAt}\``);
  lines.push("");
  lines.push(`Total files: **${allFiles.length}**`);
  lines.push("");
  lines.push("```txt");
  for (const f of allFiles) lines.push(f);
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const generatedAt = new Date().toISOString();
  const absOutDir = path.join(repoRoot, OUT_DIR);
  ensureDir(absOutDir);

  const docsJsonPath = path.join(repoRoot, "docs.json");
  if (!exists(docsJsonPath)) {
    console.error("docs.json not found in repo root.");
    process.exit(1);
  }

  const docs = readJson(docsJsonPath);
  const tabs = docs?.navigation?.tabs ?? [];

  // Build sections from docs.json
  // We will create:
  // - Guías: all pages from tab "Guías"
  // - API reference: pages from tab "API reference" (non-openapi pages)
  // - OpenAPI: the openapi json referenced by the "Endpoints" group (if present)
  /** @type {Array<{ id: string, filename: string, title: string, items: Array<{rel:string, abs:string, kind:"page"|"asset"}> }>} */
  const bundles = [];

  // Helper: collect pages for a tab by tab name
  function collectTabPages(tabName) {
    const tab = tabs.find((t) => t.tab === tabName);
    if (!tab) return [];

    const pageIds = [];
    for (const g of tab.groups ?? []) {
      for (const p of g.pages ?? []) {
        pageIds.push(p);
      }
    }
    return pageIds;
  }

  // Guías
  {
    const pageIds = collectTabPages("Guías");
    const items = [];

    for (const id of pageIds) {
      const resolved = resolvePageToFile(id);
      if (!resolved) {
        console.warn(`⚠️ Missing page file for: ${id}`);
        continue;
      }
      if (isExcludedPath(resolved.rel)) continue;
      items.push({ ...resolved, kind: "page" });
    }

    bundles.push({
      id: "01",
      filename: "01-guias.md",
      title: "Guías",
      items,
    });
  }

  // API reference pages (excluding openapi group)
  {
    const pageIds = collectTabPages("API reference");
    const items = [];

    for (const id of pageIds) {
      const resolved = resolvePageToFile(id);
      if (!resolved) {
        // This is normal if the tab uses openapi only and no pages besides intro.
        console.warn(`⚠️ Missing page file for: ${id}`);
        continue;
      }
      if (isExcludedPath(resolved.rel)) continue;
      items.push({ ...resolved, kind: "page" });
    }

    bundles.push({
      id: "02",
      filename: "02-api-reference.md",
      title: "API reference",
      items,
    });
  }

  // OpenAPI (from docs.json navigation)
  {
    let openapiRef = null;

    const apiTab = tabs.find((t) => t.tab === "API reference");
    if (apiTab) {
      for (const g of apiTab.groups ?? []) {
        if (g.openapi) {
          openapiRef = g.openapi;
          break;
        }
      }
    }

    const items = [];
    if (openapiRef) {
      const resolved = resolveOpenApi(openapiRef);
      if (resolved && !isExcludedPath(resolved.rel)) {
        items.push({ ...resolved, kind: "asset" });
      } else {
        console.warn(`⚠️ OpenAPI file not found: ${openapiRef}`);
      }
    } else {
      console.warn("⚠️ No openapi reference found in docs.json.");
    }

    bundles.push({
      id: "03",
      filename: "03-openapi.md",
      title: "OpenAPI spec",
      items,
    });
  }

  // LIST MODE(S)
  if (ANY_LIST_MODE) {
    const sections = bundles.map((b) => {
      const files = b.items.map((it) => {
        const stat = fs.statSync(it.abs);
        return { rel: it.rel, size: stat.size };
      });
      return { id: b.id, title: b.title, files };
    });

    if (LIST_MODE) {
      const manifest = renderFilesManifest({ generatedAt, sections });
      fs.writeFileSync(path.join(absOutDir, "FILES.md"), manifest, "utf8");
      console.log(`✅ ${OUT_DIR}/FILES.md`);
    }

    if (LIST_ALL_MODE) {
      const set = new Set();
      for (const b of bundles) for (const it of b.items) set.add(it.rel);
      const allFiles = [...set].sort((a, b) => a.localeCompare(b));

      fs.writeFileSync(
        path.join(absOutDir, "FILES_ALL.txt"),
        allFiles.join("\n") + "\n",
        "utf8"
      );

      const md = renderFilesAllMarkdown({ generatedAt, allFiles });
      fs.writeFileSync(path.join(absOutDir, "FILES_ALL.md"), md, "utf8");

      console.log(`✅ ${OUT_DIR}/FILES_ALL.txt`);
      console.log(`✅ ${OUT_DIR}/FILES_ALL.md`);
    }

    for (const b of bundles) {
      console.log(`   - ${b.id} ${b.title}: ${b.items.length} files`);
      for (const file of b.items) {
        console.log(`       ${file.rel}`);
      }
    }
    return;
  }

  // BUILD MODE
  const bundleOutputs = [];

  for (const b of bundles) {
    const md = renderBundleMarkdown({
      title: b.title,
      generatedAt,
      items: b.items,
    });

    fs.writeFileSync(path.join(absOutDir, b.filename), md, "utf8");
    bundleOutputs.push({ title: b.title, filename: b.filename });
    console.log(`✅ ${OUT_DIR}/${b.filename} (files: ${b.items.length})`);
  }

  const indexMd = renderIndex({
    generatedAt,
    bundles: bundleOutputs,
    docsJsonPath: "docs.json",
  });

  fs.writeFileSync(path.join(absOutDir, "00-index.md"), indexMd, "utf8");
  console.log(`✅ ${OUT_DIR}/00-index.md`);
}

main();

#!/usr/bin/env node
/**
 * Ensure web/out files fit TapeOut HashPort limits (~8.4 MB per file).
 * Usage (from repo root or web/): node scripts/check-static-out.mjs [path]
 */
import { readdir, stat, access } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MAX = 8.4 * 1024 * 1024;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveRoot() {
  if (process.argv[2]) return process.argv[2];
  for (const c of [join(repoRoot, "web", "out"), join(process.cwd(), "out"), "web/out", "out"]) {
    if (await exists(c)) return c;
  }
  return join(repoRoot, "web", "out");
}

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else out.push({ path: p, size: s.size });
  }
  return out;
}

const root = await resolveRoot();
const files = await walk(root);
files.sort((a, b) => b.size - a.size);
const total = files.reduce((n, f) => n + f.size, 0);
const over = files.filter((f) => f.size > MAX);

console.log(`root: ${root}`);
console.log(`files: ${files.length}`);
console.log(`total: ${(total / (1024 * 1024)).toFixed(2)} MB`);
console.log("largest:");
for (const f of files.slice(0, 10)) {
  console.log(`  ${(f.size / (1024 * 1024)).toFixed(2)} MB  ${relative(root, f.path)}`);
}
if (over.length) {
  console.error(`FAIL: ${over.length} file(s) exceed 8.4 MB`);
  for (const f of over) console.error(`  ${f.path}`);
  process.exit(1);
}
console.log("OK: all files under 8.4 MB");

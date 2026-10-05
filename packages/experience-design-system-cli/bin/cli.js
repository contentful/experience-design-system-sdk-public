#!/usr/bin/env node
// Suppress the SQLite ExperimentalWarning before any modules load.
// Must use dynamic import so this handler registers before sqlite is imported.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name === "ExperimentalWarning" && w.message.includes("SQLite")) return;
  process.stderr.write(`${w.name}: ${w.message}\n`);
});

// Auto-rebuild when running from source (dev mode only).
// Skipped when src/ doesn't exist (e.g. npm-installed users).
import { existsSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

function newestMtime(dir, depth = 0) {
  if (depth > 10) return 0;
  let max = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, newestMtime(full, depth + 1));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      max = Math.max(max, statSync(full).mtimeMs);
    }
  }
  return max;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const srcDir = join(pkgRoot, "src");
const distEntry = join(pkgRoot, "dist", "src", "index.js");

if (
  existsSync(srcDir) &&
  existsSync(distEntry) &&
  process.env.NODE_ENV !== "test"
) {
  const distMtime = statSync(distEntry).mtimeMs;
  if (newestMtime(srcDir) > distMtime) {
    process.stderr.write("⚙ Source changed — rebuilding...\n");
    const tsc = join(pkgRoot, "node_modules", ".bin", "tsc");
    try {
      execFileSync(tsc, ["-p", join(pkgRoot, "tsconfig.build.json")], {
        stdio: ["ignore", "ignore", "inherit"],
        cwd: pkgRoot,
      });
      process.stderr.write("✓ Build complete\n");
    } catch {
      process.stderr.write("✗ Build failed — running with existing dist\n");
    }
  }
}

await import("../dist/src/index.js");

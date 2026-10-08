#!/usr/bin/env node
// Dev loop for the TUI: rebuilds dist/ whenever the source changes and restarts the app.
//
//   experiences import --watch [import args...]      (when run from a repo checkout)
//   pnpm -F @contentful/experience-design-system-cli dev [args...]
//
// Writes dist/index.js and dist/app.js in place and never deletes dist/ or legacy/, unlike `pnpm build`.
// Edits to the legacy package are not picked up: the Import option runs the bundled copy in legacy/.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const common = {
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
};

let child;
let restarting = false;
let shuttingDown = false;

function resetTerminal() {
  // Ink hides the cursor and uses raw mode; make sure the terminal is usable between runs.
  if (process.stdout.isTTY) process.stdout.write("\x1b[?25h\x1b[0m");
}

function start() {
  child = spawn(process.execPath, [join(root, "dist", "index.js"), ...args], {
    stdio: "inherit",
  });
  child.on("exit", (code) => {
    child = undefined;
    if (restarting) {
      restarting = false;
      start();
    } else if (!shuttingDown) {
      // The user quit the app (or it crashed). Leave the watcher running so the next save starts it again.
      resetTerminal();
      console.log(
        `\n[dev] app exited (${code ?? "signal"}). Save a file to start it again, Ctrl+C to stop.`,
      );
    }
  });
}

function restart(reason) {
  if (reason) console.log(`\n[dev] ${reason}`);
  resetTerminal();
  if (child) {
    restarting = true;
    child.kill("SIGTERM");
  } else {
    start();
  }
}

let first = true;
const reportBuilds = {
  name: "report-builds",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.log("\n[dev] build failed:");
        for (const e of result.errors)
          console.log(
            `  ${e.location?.file ?? ""}:${e.location?.line ?? ""} ${e.text}`,
          );
        return;
      }
      if (first) return;
      restart("rebuilt, restarting");
    });
  },
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ["index.ts"],
    outfile: "dist/index.js",
    external: ["./app.js", "commander", "ink", "react"],
    plugins: [reportBuilds],
  }),
  esbuild.context({
    ...common,
    entryPoints: ["app.tsx"],
    outfile: "dist/app.js",
    external: ["commander", "ink", "react"],
    plugins: [reportBuilds],
  }),
]);

await Promise.all(contexts.map((c) => c.rebuild().catch(() => undefined)));
first = false;
await Promise.all(contexts.map((c) => c.watch()));
console.log("[dev] watching for changes. Ctrl+C to stop.");
start();

async function shutdown() {
  shuttingDown = true;
  child?.kill("SIGTERM");
  await Promise.all(contexts.map((c) => c.dispose()));
  resetTerminal();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

import type { Command } from 'commander';
import { join, resolve } from 'node:path';
import { updateRun } from './store.js';
import { resolveRunTarget } from './resolve-run-target.js';
import { printComponentsFromSession, printTokensFromSession } from './export-helpers.js';

export type ExportCommandOptions = {
  runIdOrPath: string;
  outDir?: string;
  push?: boolean;
};

/**
 * `experiences export <run-id-or-path>` — re-emit components.json + tokens.json
 * from a prior run's pipeline.db session without re-running extraction /
 * generation. The positional accepts either a run-id or a filesystem path that
 * matches a recorded run's savePath, mirroring `git checkout` accepting a sha
 * or a ref. See dsi-tui-local-save-tooling-spec.md Part 4.
 */
export async function runExportCommand(opts: ExportCommandOptions): Promise<void> {
  const run = await resolveRunTarget(opts.runIdOrPath);
  const sessionId = run.generateSessionId ?? run.extractSessionId;
  const outDir = opts.outDir ? resolve(opts.outDir) : run.savePath;
  const componentsResult = await printComponentsFromSession({
    sessionId,
    outPath: join(outDir, 'components.json'),
  });
  if (!componentsResult.ok) {
    throw new Error(
      `Run ${run.id} no longer available in pipeline.db (${componentsResult.error}). Use 'experiences import' to start fresh.`,
    );
  }
  // Tokens are optional — silently skip if the session has none.
  await printTokensFromSession({ sessionId, outPath: join(outDir, 'tokens.json') }).catch(() => undefined);

  await updateRun(run.id, {
    savePath: outDir,
    createdAt: new Date().toISOString(),
  });

  process.stdout.write(`Exported run ${run.id} to ${outDir}\n`);
}

export function registerExportCommand(program: Command): void {
  program
    .command('export <run-id-or-path>')
    .description("Re-emit components.json / tokens.json from a prior run's pipeline.db session")
    .option('--out-dir <path>', "Output directory (defaults to the run's recorded save path)")
    .option('--push', 'Also push to the recorded space/environment after writing')
    .action(async (runIdOrPath: string, options: { outDir?: string; push?: boolean }) => {
      try {
        await runExportCommand({
          runIdOrPath,
          ...(options.outDir ? { outDir: options.outDir } : {}),
          ...(options.push ? { push: true } : {}),
        });
      } catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });
}

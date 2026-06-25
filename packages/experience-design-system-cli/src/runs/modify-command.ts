import type { Command } from 'commander';
import { resolve } from 'node:path';
import { resolveRunTarget } from './resolve-run-target.js';
import { launchModifyWizard, type ModifyLauncherInput } from './modify-launcher.js';

export type ModifyCommandOptions = {
  runIdOrPath: string;
  saveAsNew?: boolean;
  overwrite?: boolean;
  outDir?: string;
};

/**
 * `experiences modify <run-id-or-path>` — re-open the wizard with a prior run's
 * extract/generate session pre-populated so the operator can tweak fields. The
 * positional accepts either a run-id or a filesystem path that matches a
 * recorded run's savePath, mirroring `git checkout` accepting a sha or a ref.
 * Default entry point is `final-review` (see spec Part 5).
 */
export async function runModifyCommand(opts: ModifyCommandOptions): Promise<void> {
  if (opts.saveAsNew && opts.overwrite) {
    throw new Error('--save-as-new and --overwrite are mutually exclusive.');
  }
  const run = await resolveRunTarget(opts.runIdOrPath);
  const saveMode: ModifyLauncherInput['saveMode'] = opts.overwrite
    ? 'overwrite'
    : opts.saveAsNew
      ? 'new'
      : 'prompt';
  await launchModifyWizard({
    extractSessionId: run.extractSessionId,
    generateSessionId: run.generateSessionId,
    projectPath: run.projectPath,
    savePath: run.savePath,
    entryStep: 'final-review',
    saveMode,
    ...(opts.outDir ? { outDirOverride: resolve(opts.outDir) } : {}),
  });
}

export function registerModifyCommand(program: Command): void {
  program
    .command('modify <run-id-or-path>')
    .description("Re-open the wizard with a prior run's session pre-loaded for field edits")
    .option('--save-as-new', 'Always save to a new path (prompts for one)')
    .option('--overwrite', "Save back to the run's recorded savePath")
    .option('--out-dir <path>', 'Save to this directory instead of prompting')
    .action(async (runIdOrPath: string, options: { saveAsNew?: boolean; overwrite?: boolean; outDir?: string }) => {
      try {
        await runModifyCommand({
          runIdOrPath,
          ...(options.saveAsNew ? { saveAsNew: true } : {}),
          ...(options.overwrite ? { overwrite: true } : {}),
          ...(options.outDir ? { outDir: options.outDir } : {}),
        });
      } catch (err) {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
    });
}

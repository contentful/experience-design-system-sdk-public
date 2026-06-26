import { join, resolve } from 'node:path';
import { resolveRunTarget } from './resolve-run-target.js';
import { updateRun } from './store.js';
import { printComponentsFromSession, printTokensFromSession } from './export-helpers.js';
import { launchModifyWizard, type ModifyLauncherInput } from './modify-launcher.js';

export type ReplayRunOptions = {
  runIdOrPath: string;
  outDir?: string;
  push?: boolean;
};

/**
 * Replay a prior run by re-emitting components.json + tokens.json from its
 * recorded pipeline.db session, without re-running extraction or generation.
 *
 * Exposed as `experiences import --from-run <id-or-path>`. The positional
 * accepts either a run-id or a filesystem path that matches a recorded run's
 * savePath, mirroring `git checkout` accepting a sha or a ref.
 */
export async function replayRun(opts: ReplayRunOptions): Promise<void> {
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

export type ModifyRunOptions = {
  runIdOrPath: string;
  saveAsNew?: boolean;
  overwrite?: boolean;
  outDir?: string;
};

/**
 * Re-open the wizard with a prior run's extract/generate session pre-populated
 * so the operator can tweak fields. Exposed as
 * `experiences import --from-run <id> --modify`. Default entry step is
 * `final-review`.
 */
export async function modifyRun(opts: ModifyRunOptions): Promise<void> {
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

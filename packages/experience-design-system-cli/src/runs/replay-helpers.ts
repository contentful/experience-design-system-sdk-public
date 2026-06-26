import { resolve } from 'node:path';
import { resolveRunTarget } from './resolve-run-target.js';
import { updateRun } from './store.js';
import { pushRunSession } from './push-helpers.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { launchModifyWizard, type ModifyLauncherInput } from './modify-launcher.js';

export type ReplayRunOptions = {
  runIdOrPath: string;
  /** From `--space-id` flag. */
  spaceId?: string;
  /** From `--environment-id` flag. */
  environmentId?: string;
  /** From `--cma-token` flag (or CONTENTFUL_MANAGEMENT_TOKEN env). */
  cmaToken?: string;
  /** From `--host` flag. */
  host?: string;
  /**
   * When true (interactive TTY), prompt for missing credentials via the
   * wizard's CredentialsStep. When false (non-TTY / CI), throw with the
   * pinned error string from the spec.
   */
  interactive?: boolean;
  /**
   * Test seam: replace the interactive prompt with a deterministic resolver.
   * The CLI surface never sets this; only used by tests.
   */
  promptForCredentials?: (need: {
    spaceId?: string;
    environmentId?: string;
    cmaToken?: string;
    host?: string;
  }) => Promise<{ spaceId: string; environmentId: string; cmaToken: string; host: string }>;
};

const MISSING_CREDS_ERROR =
  "--push-from-run requires credentials (space-id / environment-id / cma-token). Pass --cma-token or run 'experiences setup' first.";

/**
 * Push a prior run's recorded pipeline.db session directly to Contentful
 * without re-running extraction or generation, and without writing any
 * components.json / tokens.json to disk.
 *
 * Exposed as `experiences import --push-from-run <id-or-path>`.
 *
 * Credentials resolution order:
 *   1. Flags on the command (`--space-id`, `--environment-id`, `--cma-token`,
 *      `--host`).
 *   2. The run record's `pushedTo` field (space / env / host only — the
 *      CMA token is never persisted).
 *   3. `~/.config/experiences/credentials.json` (the `experiences setup`
 *      store) and matching env vars.
 *   4. If still incomplete and interactive: open the wizard's existing
 *      credentials step. If non-TTY: error.
 */
export async function replayRun(opts: ReplayRunOptions): Promise<void> {
  const run = await resolveRunTarget(opts.runIdOrPath);
  const sessionId = run.generateSessionId ?? run.extractSessionId;

  // Layered credentials resolution.
  const stored = await readExperiencesCredentials();
  let spaceId = opts.spaceId || run.pushedTo?.spaceId || stored.spaceId || '';
  let environmentId =
    opts.environmentId || run.pushedTo?.environmentId || stored.environmentId || '';
  let cmaToken = opts.cmaToken || stored.cmaToken || '';
  let host = opts.host || run.pushedTo?.host || stored.host || '';

  if (!spaceId || !environmentId || !cmaToken) {
    if (!opts.interactive) {
      throw new Error(MISSING_CREDS_ERROR);
    }
    const prompt =
      opts.promptForCredentials ??
      (async (need) => {
        const { promptForPushCredentials } = await import('./push-creds-prompt.js');
        return promptForPushCredentials({
          ...(need.spaceId ? { initialSpaceId: need.spaceId } : {}),
          ...(need.environmentId ? { initialEnvironmentId: need.environmentId } : {}),
          ...(need.cmaToken ? { initialCmaToken: need.cmaToken } : {}),
          ...(need.host ? { initialHost: need.host } : {}),
          summary: `Push run ${run.id} → enter credentials. Defaults reflect the run record and your saved setup.`,
        });
      });
    const collected = await prompt({
      spaceId,
      environmentId,
      cmaToken,
      host,
    });
    spaceId = collected.spaceId;
    environmentId = collected.environmentId;
    cmaToken = collected.cmaToken;
    host = collected.host;
    if (!spaceId || !environmentId || !cmaToken) {
      throw new Error(MISSING_CREDS_ERROR);
    }
  }

  const result = await pushRunSession({
    sessionId,
    spaceId,
    environmentId,
    cmaToken,
    ...(host ? { host } : {}),
  });
  if (!result.ok) {
    throw new Error(result.error);
  }

  await updateRun(run.id, {
    pushedTo: { spaceId, environmentId, host: host || '' },
  });

  const componentLine = `Pushed ${run.componentCount} component${run.componentCount === 1 ? '' : 's'} to ${spaceId}/${environmentId}`;
  const tokensLine =
    run.tokenCount > 0
      ? ` (also: ${run.tokenCount} token${run.tokenCount === 1 ? '' : 's'})`
      : '';
  process.stdout.write(`${componentLine}${tokensLine}\n`);
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
 * `experiences import --modify <id-or-path>`. Default entry step is
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
    // Pre-fill credentials from the run record's last push so the operator
    // doesn't have to re-type space/environment/host on modify. The CMA
    // token is never persisted, so it still resolves via env var /
    // credentials.json / interactive prompt at the credentials step.
    ...(run.pushedTo?.spaceId ? { initialSpaceId: run.pushedTo.spaceId } : {}),
    ...(run.pushedTo?.environmentId ? { initialEnvironmentId: run.pushedTo.environmentId } : {}),
    ...(run.pushedTo?.host ? { initialHost: run.pushedTo.host } : {}),
  });
}

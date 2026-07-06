/**
 * Push-from-picker launcher. When the operator selects "Push" from the
 * interactive run-picker, we mount the wizard with seeded session IDs and
 * `initialStep: 'push-from-picker'` so they see the same preview + push UX
 * as a fresh `experiences import` (preview → diff review → pushing progress
 * bars → done with view URL).
 *
 * This is deliberately parallel to `modify-launcher.ts`. The `--push-from-run`
 * CLI flag path (headless shell-out via `replayRun`) is preserved for
 * scripted / non-TTY use.
 */

export type PushLauncherInput = {
  extractSessionId: string;
  generateSessionId: string | null;
  /** Token session id from the run record; null when no tokens were
   *  generated. Forwarded to the wizard so preview picks up tokens too. */
  tokenSessionId?: string | null;
  projectPath: string;
  savePath: string;
  /** Absolute path to the run's tokens.json on disk (from the run record).
   *  Forwarded to the wizard so runPreview can hydrate DTCG tokens without
   *  re-emitting them to disk. Null when the run had no tokens. */
  tokensPath?: string | null;
  /** Pre-fill space id (from the run record's pushedTo or credentials.json). */
  initialSpaceId?: string;
  /** Pre-fill environment id (from the run record's pushedTo or credentials.json). */
  initialEnvironmentId?: string;
  /** Pre-fill host (from the run record's pushedTo or credentials.json). */
  initialHost?: string;
  /** Pre-fill CMA token (from credentials.json / env). */
  initialCmaToken?: string;
};

export async function launchPushWizard(input: PushLauncherInput): Promise<void> {
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { WizardApp } = await import('../import/tui/WizardApp.js');
  type WizardProps = {
    initialProjectPath?: string;
    seedExtractSessionId?: string;
    seedGenerateSessionId?: string;
    seedTokenSessionId?: string;
    seedTokensPath?: string;
    initialStep?: 'scope-gate' | 'final-review' | 'push-from-picker';
    initialSpaceId?: string;
    initialEnvironmentId?: string;
    initialHost?: string;
    initialCmaToken?: string;
  };
  const props: WizardProps = {
    initialProjectPath: input.projectPath,
    seedExtractSessionId: input.extractSessionId,
    initialStep: 'push-from-picker',
  };
  if (input.generateSessionId) props.seedGenerateSessionId = input.generateSessionId;
  if (input.tokenSessionId) props.seedTokenSessionId = input.tokenSessionId;
  if (input.tokensPath) props.seedTokensPath = input.tokensPath;
  if (input.initialSpaceId) props.initialSpaceId = input.initialSpaceId;
  if (input.initialEnvironmentId) props.initialEnvironmentId = input.initialEnvironmentId;
  if (input.initialHost) props.initialHost = input.initialHost;
  if (input.initialCmaToken) props.initialCmaToken = input.initialCmaToken;
  const { waitUntilExit } = render(createElement<WizardProps>(WizardApp, props));
  await waitUntilExit();
}

export type PickerPushRunOptions = {
  runIdOrPath: string;
  /** From `--space-id` flag. */
  spaceId?: string;
  /** From `--environment-id` flag. */
  environmentId?: string;
  /** From `--cma-token` flag. */
  cmaToken?: string;
  /** From `--host` flag. */
  host?: string;
  /** When true, bypass the source/saved-file staleness check. */
  force?: boolean;
};

/**
 * Interactive picker-Push entry point. Resolves the run record, applies the
 * staleness gate, layers credentials (flag → pushedTo → credentials.json),
 * and mounts the wizard via `launchPushWizard`.
 */
export async function pickerPushRun(opts: PickerPushRunOptions): Promise<void> {
  const { resolveRunTarget } = await import('./resolve-run-target.js');
  const { readExperiencesCredentials } = await import('../credentials-store.js');
  const { checkRunStaleness, formatStalenessDetail } = await import('./staleness.js');
  const run = await resolveRunTarget(opts.runIdOrPath);
  if (!opts.force) {
    const staleness = await checkRunStaleness(run);
    if (staleness.stale) {
      const detail = formatStalenessDetail(staleness);
      throw new Error(
        [
          `Refusing to push run ${run.id} — source or saved files have drifted since the run was recorded.`,
          ...detail,
          '',
          'Re-extract with `experiences import --project <path>` for a fresh run, or pass --force to bypass.',
        ].join('\n'),
      );
    }
  }
  const stored = await readExperiencesCredentials();
  const spaceId = opts.spaceId || run.pushedTo?.spaceId || stored.spaceId || '';
  const environmentId = opts.environmentId || run.pushedTo?.environmentId || stored.environmentId || '';
  const cmaToken = opts.cmaToken || stored.cmaToken || '';
  const host = opts.host || run.pushedTo?.host || stored.host || '';

  await launchPushWizard({
    extractSessionId: run.extractSessionId,
    generateSessionId: run.generateSessionId,
    tokenSessionId: run.tokenSessionId,
    projectPath: run.projectPath,
    savePath: run.savePath,
    tokensPath: run.tokensPath,
    ...(spaceId ? { initialSpaceId: spaceId } : {}),
    ...(environmentId ? { initialEnvironmentId: environmentId } : {}),
    ...(host ? { initialHost: host } : {}),
    ...(cmaToken ? { initialCmaToken: cmaToken } : {}),
  });
}

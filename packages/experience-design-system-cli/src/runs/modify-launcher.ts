/**
 * Thin indirection so `runModifyCommand` can be unit-tested without spinning
 * up the real Ink wizard. The production implementation lives here.
 */

export type ModifyLauncherInput = {
  extractSessionId: string;
  generateSessionId: string | null;
  /** Token session id from the run record; null when no tokens were
   *  generated. Forwarded to the wizard so the modify entry pre-loads
   *  tokens alongside the extract/generate sessions. */
  tokenSessionId?: string | null;
  projectPath: string;
  savePath: string;
  entryStep: 'scope-gate' | 'final-review';
  saveMode: 'overwrite' | 'new' | 'prompt';
  outDirOverride?: string;
  /** Pre-fill space id (from the run record's pushedTo). */
  initialSpaceId?: string;
  /** Pre-fill environment id (from the run record's pushedTo). */
  initialEnvironmentId?: string;
  /** Pre-fill host (from the run record's pushedTo). */
  initialHost?: string;
};

export async function launchModifyWizard(input: ModifyLauncherInput): Promise<void> {
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { WizardApp } = await import('../import/tui/WizardApp.js');
  type WizardProps = {
    initialProjectPath?: string;
    outDirOverride?: string;
    seedExtractSessionId?: string;
    seedGenerateSessionId?: string;
    seedTokenSessionId?: string;
    initialStep?: 'scope-gate' | 'final-review';
    initialSpaceId?: string;
    initialEnvironmentId?: string;
    initialHost?: string;
  };
  // Modify entry: re-open the wizard with the prior run's sessions seeded so
  // extract + generate are skipped. The wizard short-circuits to `initialStep`
  // (typically `final-review`) using state derived from the seed IDs. Saved
  // credentials from the run record's `pushedTo` pre-fill the credentials
  // step (CMA token is never persisted, so it still falls through to the
  // env/credentials.json/prompt resolution path).
  const props: WizardProps = {
    initialProjectPath: input.projectPath,
    seedExtractSessionId: input.extractSessionId,
    initialStep: input.entryStep,
  };
  if (input.generateSessionId) props.seedGenerateSessionId = input.generateSessionId;
  if (input.tokenSessionId) props.seedTokenSessionId = input.tokenSessionId;
  if (input.saveMode === 'overwrite') props.outDirOverride = input.savePath;
  if (input.outDirOverride) props.outDirOverride = input.outDirOverride;
  if (input.initialSpaceId) props.initialSpaceId = input.initialSpaceId;
  if (input.initialEnvironmentId) props.initialEnvironmentId = input.initialEnvironmentId;
  if (input.initialHost) props.initialHost = input.initialHost;
  const { waitUntilExit } = render(createElement<WizardProps>(WizardApp, props));
  await waitUntilExit();
}

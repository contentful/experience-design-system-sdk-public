/**
 * Thin indirection so `runModifyCommand` can be unit-tested without spinning
 * up the real Ink wizard. The production implementation lives here.
 */

export type ModifyLauncherInput = {
  extractSessionId: string;
  generateSessionId: string | null;
  projectPath: string;
  savePath: string;
  entryStep: 'scope-gate' | 'final-review';
  saveMode: 'overwrite' | 'new' | 'prompt';
  outDirOverride?: string;
};

export async function launchModifyWizard(input: ModifyLauncherInput): Promise<void> {
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { WizardApp } = await import('../import/tui/WizardApp.js');
  type WizardProps = {
    initialProjectPath?: string;
    outDirOverride?: string;
  };
  // The wizard's "modify" entry hooks into the same render path as a normal
  // import, but the session refs are seeded. The wizard itself does not yet
  // honor `entryStep` — we only wire the override + initial project path so
  // post-final-review save lands in the right place. Future work can extend
  // WizardApp to short-circuit extract/generate when these props are present.
  const props: WizardProps = { initialProjectPath: input.projectPath };
  if (input.saveMode === 'overwrite') props.outDirOverride = input.savePath;
  if (input.outDirOverride) props.outDirOverride = input.outDirOverride;
  const { waitUntilExit } = render(createElement<WizardProps>(WizardApp, props));
  await waitUntilExit();
}

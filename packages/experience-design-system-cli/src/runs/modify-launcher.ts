/**
 * Thin indirection so `runModifyCommand` can be unit-tested without spinning
 * up the real Ink wizard. The production implementation lives here.
 */

import type { CompositionMode } from '../lib/composition-mode.js';
import type { WizardAppProps } from '../import/tui/WizardApp.js';
import { launchWizard } from './wizard-launcher.js';
import { applyWizardSeedProps } from './wizard-seed.js';

export type ModifyLauncherInput = {
  extractSessionId: string;
  generateSessionId: string | null;
  /** Token session id from the run record; null when no tokens were
   *  generated. Forwarded to the wizard so the modify entry pre-loads
   *  tokens alongside the extract/generate sessions. */
  tokenSessionId?: string | null;
  /** Absolute path to the complete DTCG token catalog written for this run. */
  tokensPath?: string | null;
  projectPath: string;
  savePath: string;
  entryStep: 'scope-gate' | 'final-review';
  saveMode: 'overwrite' | 'new' | 'prompt';
  /** Composition mode from the run record, so the modify wizard resumes in the
   *  same mode. Omitted → the wizard's default (`atomic`). */
  compositionMode?: CompositionMode;
  outDirOverride?: string;
  /** Pre-fill space id (from the run record's pushedTo). */
  initialSpaceId?: string;
  /** Pre-fill environment id (from the run record's pushedTo). */
  initialEnvironmentId?: string;
  /** Pre-fill host (from the run record's pushedTo). */
  initialHost?: string;
  /** Pre-fill CMA token (from credentials.json / env). */
  initialCmaToken?: string;
  /** From `--allow-deletions` flag. Forwarded to wizard's push step. */
  allowDeletions?: boolean;
};

export async function launchModifyWizard(input: ModifyLauncherInput): Promise<void> {
  // Modify entry: re-open the wizard with the prior run's sessions seeded so
  // extract + generate are skipped. The wizard short-circuits to `initialStep`
  // (typically `final-review`) using state derived from the seed IDs. Saved
  // credentials from the run record's `pushedTo` pre-fill the credentials
  // step (CMA token is never persisted, so it still falls through to the
  // env/credentials.json/prompt resolution path).
  const props: WizardAppProps = {
    initialProjectPath: input.projectPath,
    seedExtractSessionId: input.extractSessionId,
    initialStep: input.entryStep,
  };
  applyWizardSeedProps(props, input);
  if (input.compositionMode) props.compositionMode = input.compositionMode;
  if (input.saveMode === 'overwrite') props.outDirOverride = input.savePath;
  if (input.outDirOverride) props.outDirOverride = input.outDirOverride;
  if (input.allowDeletions !== undefined) props.allowDeletions = input.allowDeletions;
  await launchWizard(props);
}

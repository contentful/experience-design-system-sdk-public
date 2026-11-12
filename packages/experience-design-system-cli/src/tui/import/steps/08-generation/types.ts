import type {
  ImportGenerationInput,
  ImportGenerationResult,
  ImportGenerationStepName,
} from '@contentful/experience-design-system-backend-pipeline';

// The generation stage runs after the user confirms the scope. It saves the decisions, generates the accepted components
// (or takes them from the cache), and maps tokens onto them. What it leaves behind is the generated session the review
// screen opens, which is what `GenerationHandoff` carries to the wizard.

export type GenerationInput = ImportGenerationInput & { hasTokens: boolean };

/** One line per thing the screen shows, in the order it shows them. */
export interface GenerationProgress {
  /**
   * Components finished, out of the total, and the one being worked on. `failed` counts the finished ones that failed: the
   * run carries on through the rest. Null until the first progress line.
   */
  components: { done: number; total: number; current: string; failed: number } | null;
  mapTokens: 'idle' | 'running' | 'complete';
  /** Whether token mapping will run at all; unknown until the generated components have been looked at. */
  mapTokensEligible: boolean | null;
}

export type GenerationStepName = ImportGenerationStepName;
export type GenerationResult = ImportGenerationResult;

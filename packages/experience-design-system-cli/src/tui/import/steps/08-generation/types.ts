import type { GenerationHandoff } from '@contentful/experience-design-system-types/handoff';
import type { ScopeDecisions } from '../07-scope-gate/types.js';

// The generation stage runs after the user confirms the scope. It saves the decisions, generates the accepted components
// (or takes them from the cache), and maps tokens onto them. What it leaves behind is the generated session the review
// screen opens, which is what `GenerationHandoff` carries to the wizard.

export interface GenerationInput {
  /** The extraction session the scope was decided on. */
  sessionId: string;
  decisions: ScopeDecisions;
  /**
   * The cache check that ran while the scope gate was open, which restores cached definitions into the pipeline
   * database. The stage waits for it before saving the decisions, since both write to that database.
   */
  cachedNames: Promise<string[]>;
  tokensPath: string;
  /** The token session extraction recorded, or null when an existing tokens.json was reused. */
  tokenSessionId: string | null;
  existingEntitiesPath: string | null;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  /** A custom prompt for `generate components`, saved in the config. Passed to the command as it is. */
  generatePromptPath?: string;
  noCache: boolean;
  /** Whether a token catalog is in use. It changes the wording of the screen, not what runs. */
  hasTokens: boolean;
}

/** One line per thing the screen shows, in the order it shows them. */
export interface GenerationProgress {
  /** Components finished, out of the total, and the one being worked on. Null until the first progress line. */
  components: { done: number; total: number; current: string } | null;
  mapTokens: 'idle' | 'running' | 'complete';
  /** Whether token mapping will run at all; unknown until the generated components have been looked at. */
  mapTokensEligible: boolean | null;
}

export type GenerationStepName = 'save decisions' | 'generate components' | 'map tokens' | `${string} auth check`;

export type GenerationResult =
  | { ok: true; generation: GenerationHandoff }
  | { ok: false; step: GenerationStepName; message: string };

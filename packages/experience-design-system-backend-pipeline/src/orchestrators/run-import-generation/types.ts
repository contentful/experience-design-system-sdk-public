import type { GenerationHandoff } from '@contentful/experience-design-system-types/handoff';
import type { GenerateComponentsProgress } from '../run-generate-components-session/types.js';

export interface ImportGenerationInput {
  /** The extraction session the scope was decided on. */
  sessionId: string;
  decisions: { accepted: string[]; rejected: string[] };
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
  componentsSkillPath?: string;
  mapTokensSkillPath?: string;
}

export type ImportGenerationProgress =
  | { kind: 'components'; event: GenerateComponentsProgress }
  | { kind: 'map-tokens'; eligible: boolean; state: 'idle' | 'running' | 'complete' };

export type ImportGenerationStepName = 'save decisions' | 'generate components' | 'map tokens' | `${string} auth check`;

export type ImportGenerationResult =
  | { ok: true; generation: GenerationHandoff }
  | { ok: false; step: ImportGenerationStepName; message: string; authStatus?: 'not-found' | 'unauthenticated' };

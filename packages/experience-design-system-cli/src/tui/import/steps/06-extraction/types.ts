import type { ExtractionHandoff } from '@contentful/experience-design-system-types/handoff';

// What the extraction stage needs, what it reports while it runs, and what it hands to the legacy wizard.

export interface ExtractionInput {
  sourceInventory?: import('@contentful/experience-design-system-backend-pipeline').SourceEvidenceInventory;
  evidenceFilePaths?: readonly string[];
  signal?: AbortSignal;
  projectPath: string;
  /** Where the stage writes tokens.json and the other files. Defaults to `<projectPath>/.contentful`. */
  outDir?: string;
  /** Absolute source files from the path-validation step (collectFiles output). */
  filePaths: string[];
  /** Raw tokens file the user pointed at. Empty when the import does not generate tokens (components only). */
  rawTokensPath: string;
  /** Null when the user skipped credentials: no existing-entities fetch happens. */
  credentials: { spaceId: string; environmentId: string; cmaToken: string; host: string } | null;
  agent: string;
  agentModel?: string;
  promptOverrides: string[];
  noCache: boolean;
}

type CompositionPhase = 'resolving' | 'cache-hit' | 'done' | `agent:${string}`;
type JobStatus = 'idle' | 'running' | 'complete' | 'failed';

/** Everything the extracting screen shows. One field per row. */
export interface ExtractionProgress {
  scan: { scanned: number; total: number | null; componentsFound?: number } | null;
  sourceActivity?: {
    phase: 'analyzing' | 'validating' | 'capturing' | 'captured' | 'publishing' | 'complete';
    activity: string;
  };
  composition: CompositionPhase;
  compositionActivity?: string;
  selection: 'running' | 'complete';
  exploration?: import('@contentful/experience-design-system-backend-pipeline').ExplorationProgressEvent;
  existingEntities: JobStatus;
  existingEntitiesActivity?: string;
  tokens: JobStatus;
  tokenActivity?: import('@contentful/experience-design-system-backend-pipeline').GenerateTokensProgress;
  tokenCount?: number;
}

/** The label the error screen shows, as the wizard labelled it. */
type ExtractionStepName =
  | 'analyze extract'
  | 'selection agent'
  | 'generate tokens'
  | 'print tokens'
  | `${string} auth check`;

export type ExtractionResult =
  | { ok: true; extraction: ExtractionHandoff }
  | { ok: false; step: ExtractionStepName; message: string };

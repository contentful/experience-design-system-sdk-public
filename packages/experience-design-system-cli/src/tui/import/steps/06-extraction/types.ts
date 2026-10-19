import type { ExtractionHandoff, ImportHandoff } from '@contentful/experience-design-system-types/handoff';

// What the extraction stage needs, what it reports while it runs, and what it hands to the legacy wizard.

export type TokenStrategy = ImportHandoff['tokens']['strategy'];

export interface ExtractionInput {
  signal?: AbortSignal;
  projectPath: string;
  /** Where the stage writes tokens.json and the other files. Defaults to `<projectPath>/.contentful`. */
  outDir?: string;
  /** Absolute source files from the path-validation step (collectFiles output). */
  filePaths: string[];
  /** Raw tokens file the user pointed at (always set: v2 asks for one). */
  rawTokensPath: string;
  /** From the token reuse step. 'reuse' skips token generation entirely. */
  tokenStrategy: TokenStrategy;
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
  scan: { scanned: number; total: number | null } | null;
  composition: CompositionPhase;
  selection: 'running' | 'complete';
  existingEntities: JobStatus;
  tokens: JobStatus;
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

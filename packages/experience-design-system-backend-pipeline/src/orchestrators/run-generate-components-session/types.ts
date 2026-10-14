import type { ExistingContentfulEntities } from '../../steps/generation/src/types/existing-entities.js';

/**
 * Per-component progress emitted during generation. Scan/extract progress
 * is NOT here — this orchestrator starts after the components are in the DB.
 */
export type GenerateComponentsProgress =
  | {
      kind: 'component:started';
      index: number;
      total: number;
      name: string;
      attempt: number;
      maxAttempts: number;
    }
  | {
      kind: 'component:cached';
      index: number;
      total: number;
      name: string;
      pinned: boolean;
    }
  | {
      kind: 'component:completed';
      index: number;
      total: number;
      name: string;
      classified: number;
      excluded: number;
      slots: number;
      warnings: string[];
    }
  | {
      kind: 'component:failed';
      index: number;
      total: number;
      name: string;
      error: string;
    }
  | {
      kind: 'component:slot-renamed';
      componentName: string;
      oldName: string;
      newName: string;
    };

export interface GeneratedComponentResult {
  componentName: string;
  classified: number;
  excluded: number;
  slots: number;
  warnings: string[];
  failed: boolean;
  error?: string;
  cached: boolean;
  renamedSlotsCount: number;
}

export interface RunGenerateComponentsSessionRequest {
  /** Session id (minted by analyze extract). Required. */
  sessionId: string;
  /** Coding agent to invoke. */
  agent: string;
  /** Optional explicit model for the agent. */
  agentModel?: string;
  /** `--prompt stage=value` overrides, repeatable, as passed through from CLI/TUI. */
  promptOverrides: string[];
  /** Inline raw-tokens JSON string, forwarded verbatim to the agent prompt. */
  tokensInline?: string;
  /** Inline token-map JSON string, forwarded verbatim to the agent prompt. */
  tokenMapInline?: string;
  /** When true: skip caches, re-run every component. */
  noCache: boolean;
  /** When true: show agent output on stderr as it arrives. */
  verbose?: boolean;
  /** Path to the --existing-entities-path file, if any. */
  existingEntitiesPath?: string | null;
  /** Pre-materialized existing entities (overrides existingEntitiesPath). */
  existingContentfulEntities?: ExistingContentfulEntities | null;
  /**
   * Components the caller already knows are cached (from an earlier
   * `--cache-status` pass). These are reused without a cache lookup.
   */
  precomputedCachedNames?: ReadonlySet<string>;
  /** Fires when a per-component event occurs. */
  onProgress?: (event: GenerateComponentsProgress) => void;
}

export interface RunGenerateComponentsSessionResponse {
  sessionId: string;
  /** Per-component result, in the same order as the components were run. */
  results: GeneratedComponentResult[];
  /** True when every result is either cached or generated. */
  allOk: boolean;
  /** Total slots renamed across all components (surfaced to the handoff). */
  renamedSlotsCount: number;
  /** `component.name -> source paths[]` for components whose names collided. */
  duplicateNames: Array<{ name: string; sources: string[] }>;
  /** Unknown-allowed-component references dropped during the pre-run filter. */
  droppedAllowedComponents: Array<{ componentName: string; slotName: string; allowedComponent: string }>;
  /** When no raw components were in the session: true. The caller errors out. */
  emptySession: boolean;
}

import type { AgentDebugEvent } from '../../agents/types/agent-run.js';
import type { ExistingContentfulEntities } from '../../steps/generation/src/types/existing-entities.js';

export type GenerateComponentsProgress =
  | { kind: 'component:resumed'; index: number; total: number; name: string }
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
  /** Explicit debug restart in the same saved session; not cross-session caching. */
  debugResume?: boolean;
  debugRequireComplete?: boolean;
  debugArtifactDir?: string;
  sessionId: string;

  signal?: AbortSignal;

  agent: string;

  agentModel?: string;

  promptOverrides: string[];

  tokensInline?: string;

  tokenMapInline?: string;

  noCache: boolean;
  verbose?: boolean;
  skillPath?: string;

  existingEntitiesPath?: string | null;

  existingContentfulEntities?: ExistingContentfulEntities | null;

  precomputedCachedNames?: ReadonlySet<string>;

  onProgress?: (event: GenerateComponentsProgress) => void;

  onDebugEvent?: AgentDebugEvent;
}

export interface RunGenerateComponentsSessionResponse {
  sessionId: string;

  results: GeneratedComponentResult[];

  allOk: boolean;

  renamedSlotsCount: number;

  duplicateNames: Array<{ name: string; sources: string[] }>;

  droppedAllowedComponents: Array<{ componentName: string; slotName: string; allowedComponent: string }>;

  emptySession: boolean;
}

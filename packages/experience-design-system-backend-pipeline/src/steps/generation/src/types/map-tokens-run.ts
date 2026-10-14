import type { AgentName } from '../../../../agents/types/agent-name.js';

export interface MapTokensRunRequest {
  sessionId?: string;
  agent: AgentName | 'skipped';
  model?: string;
  printPrompt?: boolean;
  skipAgent?: boolean;
  cache?: boolean;
  tokenMapInline?: Record<string, string>;
  existingEntitiesInline?: string;
  skillContentOverride?: string;
  skillPathOverride?: string;
  agentTimeoutMs?: number;
}

/**
 * Diagnostics surfaced to the caller: token-map entries referencing unknown
 * paths, and `resolveTokenDefaults` resolution issues (ambiguous paths, no
 * match, conflicts with manual mappings). Legacy emitted these to stderr; the
 * orchestrator returns them so the caller owns final presentation.
 */
export type MapTokensRunResult =
  | {
      type: 'nothing-to-map';
      sessionId: string;
      mappablePropCount: number;
      tokenCount: number;
      diagnostics: string[];
    }
  | {
      type: 'printed-prompt';
      sessionId: string;
      prompt: string;
      diagnostics: string[];
    }
  | {
      type: 'skipped';
      sessionId: string;
      stepId: number;
      diagnostics: string[];
    }
  | {
      type: 'cached';
      sessionId: string;
      applied: number;
      stepId: number;
      diagnostics: string[];
    }
  | {
      type: 'applied';
      sessionId: string;
      applied: number;
      warnings: string[];
      stepId: number;
      diagnostics: string[];
    };

export type MapTokensRunError =
  | { type: 'no-session'; command: 'generate components' }
  | { type: 'no-components'; sessionId: string }
  | { type: 'binary-not-found'; agent: AgentName; binary: string; skillPath: string }
  | { type: 'agent-failed'; sessionId: string; stepId: number; error: string };

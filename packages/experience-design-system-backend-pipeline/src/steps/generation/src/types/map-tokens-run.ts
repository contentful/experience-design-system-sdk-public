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

export type MapTokensRunResult =
  | {
      type: 'nothing-to-map';
      sessionId: string;
      mappablePropCount: number;
      tokenCount: number;
    }
  | {
      type: 'printed-prompt';
      sessionId: string;
      prompt: string;
    }
  | {
      type: 'skipped';
      sessionId: string;
      stepId: number;
    }
  | {
      type: 'cached';
      sessionId: string;
      applied: number;
      stepId: number;
    }
  | {
      type: 'applied';
      sessionId: string;
      applied: number;
      warnings: string[];
      stepId: number;
    };

export type MapTokensRunError =
  | { type: 'no-session'; command: 'generate components' }
  | { type: 'no-components'; sessionId: string }
  | { type: 'binary-not-found'; agent: AgentName; binary: string; skillPath: string }
  | { type: 'agent-failed'; sessionId: string; stepId: number; error: string };

import type { CDFComponentEntry } from '../../../steps/shared/index.js';

export interface WriteResult {
  createdCount: number;
  updatedCount: number;
  failedCount: number;
}

export interface SelectionDecision {
  decision: 'accepted' | 'rejected';
  reason: string | null;
}

export interface SessionHandle {
  id: string;
  composition: {
    lookup(inputHash: string): string | null;
    store(inputHash: string, agentOutput: string): void;
  };
  selection: {
    lookup(componentHash: string, promptHash: string): SelectionDecision | null;
    store(componentHash: string, promptHash: string, decision: 'accepted' | 'rejected', reason: string | null): void;
  };
  generation: {
    lookup(inputHash: string, promptHash: string): CDFComponentEntry | null;
    store(inputHash: string, promptHash: string, entry: CDFComponentEntry): void;
  };
  close(): void;
}

export interface OpenSessionOptions {
  dbPath?: string;
  sessionId?: string;
  cliVersion: string;
}

import type { AgentName } from './agent-name.js';
import type { AgentAuthStatus, AgentConversation, AgentDebugEvent, AgentRunResult } from './agent-run.js';

export interface AgentAssignmentBinding {
  sourceDigest: string;
  rulesDigest: string;
  toolsDigest: string;
  contextDigest: string;
  environmentDigest: string;
  model: string;
  role: string;
}

export interface AgentAssignment {
  id: string;
  binding: AgentAssignmentBinding;
  inventory: readonly string[];
  admittedPrerequisites: readonly { assignmentId: string; outputDigest: string; admissionDigest: string }[];
  validators: readonly { path: string; digest: string }[];
}

export interface RelatedBatchHandoff {
  operationId: string;
  token: string;
  conversation: AgentConversation;
  binding: AgentAssignmentBinding;
  prerequisite: { assignmentId: string; outputDigest: string; admissionDigest: string };
}

export interface CodexAppServerOptions {
  operationId: string;
  timeoutMs: number;
  maxConcurrency?: number;
  maxQueue?: number;
  maxSessions?: number;
  maxBufferBytes?: number;
  requestTimeoutMs?: number;
  drainTimeoutMs?: number;
}

export interface PersistentAgentMeasurements {
  transport: 'codex-app-server';
  invocationElapsedMs: number;
  queueMs: number;
  startupMs?: number;
  initializationMs?: number;
  firstEventMs?: number;
  firstOutputMs?: number;
  turnElapsedMs?: number;
}

export interface PersistentAgentUsage {
  source: 'codex.app-server.thread/tokenUsage/updated';
  scope: 'last-turn';
  counters: Record<string, number>;
}

export interface PersistentAgentRunResult extends AgentRunResult {
  persistentMeasurements?: PersistentAgentMeasurements;
  persistentUsage?: PersistentAgentUsage;
  transportFailure?: string;
  rpcCode?: number;
  providerFailure?: { code: string; httpStatusCode?: number };
}

export interface PersistentAgentInvoker extends AgentInvoker, PersistentAgentLifetime {
  invoke(options: InvokeAgentOptions): Promise<PersistentAgentRunResult>;
}

export interface PersistentAgentLifetime {
  close(): Promise<void>;
  admit(assignmentId: string, outputDigest: string, admissionDigest: string): void;
  createHandoff(assignmentId: string): RelatedBatchHandoff;
}

export interface InvokeAgentOptions {
  agent: AgentName;
  model?: string;
  bedrock?: boolean;
  prompt: string;
  timeoutMs: number;
  onOutput?: (chunk: string) => void;
  signal?: AbortSignal;
  preserveConversation?: boolean;
  conversation?: AgentConversation;
  assignment?: AgentAssignment;
  relatedBatch?: RelatedBatchHandoff;
}

/**
 * Abstracts "invoke an agent and get a result back" from the local-subprocess
 * mechanism `runAgent` uses today. A remote implementation (e.g. against an
 * internal agents service) implements the same contract without importing
 * this package's subprocess transport.
 */
export interface AgentInvoker {
  invoke(options: InvokeAgentOptions): Promise<AgentRunResult>;
  checkAuth(agent: AgentName): Promise<AgentAuthStatus>;
}

export interface CreateLocalCliAgentInvokerOptions {
  /** Wire in a debug-event sink (e.g. the CLI's own debug logger). No-op by default. */
  onDebugEvent?: AgentDebugEvent;
  codexAppServer?: CodexAppServerOptions;
}

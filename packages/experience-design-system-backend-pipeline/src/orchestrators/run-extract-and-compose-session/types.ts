import type { RawComponentDefinition } from '../../steps/extraction/src/types/component.js';
import type { EdgeConflict } from '../../steps/composition/src/helpers/edges/merge-edges.js';
import type { AgentDebugEvent } from '../../agents/types/agent-run.js';
import type { ResolveCompositionServiceResult } from '../../steps/composition/src/types/contract.js';

/**
 * Structured progress events emitted during extraction and composition.
 * Scan progress is NOT included here — callers walk the project tree
 * themselves (via `collectFiles`) and emit their own scan progress before
 * handing `filePaths` to the orchestrator.
 */
export type ExtractAndComposeProgress =
  | { kind: 'extract'; done: number; total: number; componentsSoFar: number }
  | { kind: 'composition'; phase: 'resolving' | 'cache-hit' | `agent:${string}` | 'done' };

export interface RunExtractAndComposeSessionRequest {
  /** Absolute project root. Used as the session's inputPath and for relative file-path storage. */
  projectPath: string;
  /** Absolute path to the session's output directory (typically `<projectPath>/.contentful`). */
  outDir: string;
  /** Source files (absolute paths) to extract from. Caller walks + filters (via `collectFiles`). */
  filePaths: string[];
  /** Coding agent used for composition mapping resolution (claude|codex|opencode|cursor). */
  agent: string;
  /** Optional explicit model for the agent. Not used by composition today but accepted for future use. */
  agentModel?: string;
  /** `--prompt stage=value` overrides, repeatable, as passed through from CLI/TUI. */
  promptOverrides: string[];
  /** When true: skip extract/composition caches, re-run everything. */
  noCache: boolean;
  /** How aggressively to retry extraction for unresolved Svelte Props types. Defaults to 'auto'. */
  resolveUnreachable?: 'auto' | 'always' | 'never';
  /** When true: force the composition agent to run even where deterministic sources answered. */
  compositionRefresh?: boolean;
  /** When true: enable Bedrock env for the composition agent (gated on agentSupportsBedrock). */
  bedrock?: boolean;
  /** Fires when a structured progress event occurs. */
  onProgress?: (event: ExtractAndComposeProgress) => void;
  /** Fires exactly once with the newly-minted sessionId, as early as possible — before any heavy work. Awaited. */
  onSessionCreated?: (sessionId: string) => void | Promise<void>;
  /** Optional debug event sink; callers own how/where events get logged. */
  onDebugEvent?: AgentDebugEvent;
  /** Optional filter-exclusion sink; callers own how/where exclusions get logged. */
  onExclusion?: (exclusion: Record<string, unknown>) => void;
}

export interface RunExtractAndComposeSessionResponse extends Pick<
  ResolveCompositionServiceResult,
  'sourceCallSiteEvidence' | 'sourceCallSiteRejections'
> {
  /** Pipeline session id. Downstream commands (select, generate, apply) read the session by this id. */
  sessionId: string;
  /** Which path composition resolution took. Carried into the handoff to v1's scope gate. */
  compositionPhase: 'done' | 'cache-hit';
  /** Final composition-enriched components. Same shape stored to the DB. */
  components: RawComponentDefinition[];
  /** Union of extraction warnings and quality-filter warnings. */
  warnings: string[];
  /** Composition edge conflicts, if any. */
  conflicts: EdgeConflict[];
  /** Composition warnings (dropped candidates, agent exit non-zero, etc.). */
  compositionWarnings: string[];
  /** Count of source files scanned (equal to `request.filePaths.length`). */
  scannedFileCount: number;
}

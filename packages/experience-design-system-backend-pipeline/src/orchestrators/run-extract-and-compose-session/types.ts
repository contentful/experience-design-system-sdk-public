import type { RawComponentDefinition } from '../../steps/extraction/src/types/component.js';
import type { EdgeConflict } from '../../steps/composition/src/helpers/edges/merge-edges.js';
import type { AgentDebugEvent } from '../../agents/types/agent-run.js';
import type { ResolveCompositionServiceResult } from '../../steps/composition/src/types/contract.js';
import type { SourceEvidenceHandle } from '../../persistence/src/session/repositories/db.js';

/**
 * Structured progress events emitted during extraction and composition.
 * Scan progress is NOT included here — callers walk the project tree
 * themselves (via `collectFiles`) and emit their own scan progress before
 * handing `filePaths` to the orchestrator.
 */
export type ExtractAndComposeProgress =
  | { kind: 'extract'; done: number; total: number; componentsSoFar: number; activity?: string }
  | { kind: 'source'; phase: 'validating' | 'capturing' | 'captured' | 'publishing' | 'complete'; activity: string }
  | { kind: 'composition'; phase: 'resolving' | 'cache-hit' | `agent:${string}` | 'done'; activity?: string };

export interface RunExtractAndComposeSessionRequest {
  evidenceFilePaths?: readonly string[];
  sourceInventory?: import('../../steps/extraction/index.js').SourceEvidenceInventory;
  signal?: AbortSignal;
  /** Absolute project root. Used as the session's inputPath and for relative file-path storage. */
  projectPath: string;
  /** Absolute path to the session's output directory (typically `<projectPath>/.contentful`). */
  outDir: string;
  /** Source files (absolute paths) to extract from. Caller walks + filters (via `collectFiles`). */
  filePaths: string[];
  /** @deprecated Extraction and composition do not invoke a coding agent. */
  agent?: string;
  /** @deprecated Extraction and composition do not invoke a coding agent. */
  agentModel?: string;
  /** `--prompt stage=value` overrides, repeatable, as passed through from CLI/TUI. */
  promptOverrides: string[];
  /** Controls extraction result saves; source analysis always runs fresh. */
  noCache: boolean;
  /** How aggressively to retry extraction for unresolved Svelte Props types. Defaults to 'auto'. */
  resolveUnreachable?: 'auto' | 'always' | 'never';
  /** @deprecated Composition always collects fresh deterministic evidence. */
  compositionRefresh?: boolean;
  /** @deprecated Composition does not invoke a coding agent. */
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
  'sourceCallSiteEvidence' | 'sourceCallSiteRejections' | 'sourceCallSiteCoverage'
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
  /** Deterministic composition warnings and edge conflicts. */
  compositionWarnings: string[];
  /** Count of source files scanned (equal to `request.filePaths.length`). */
  scannedFileCount: number;
  /** Identity of the immutable source envelope committed with the completed extraction step. */
  sourceEvidenceHandle: SourceEvidenceHandle;
}

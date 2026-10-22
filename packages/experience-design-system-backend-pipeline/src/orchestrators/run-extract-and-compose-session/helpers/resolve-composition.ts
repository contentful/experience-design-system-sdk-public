import { resolveMapping } from '../../../steps/composition/src/helpers/edges/resolve-mapping.js';
import type { ResolveCompositionServiceResult } from '../../../steps/composition/src/types/contract.js';
import { readCompositionFiles } from './read-composition-files.js';
import type { EdgeConflict } from '../../../steps/composition/src/helpers/edges/merge-edges.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import type { ExtractAndComposeProgress } from '../types.js';
import { throwIfAborted } from '../../../helpers/abort.js';
import type { SourceCapture } from '../../../steps/extraction/index.js';
import { deriveComponentId } from '../../../persistence/src/session/helpers/components/derive-component-id.js';
import { runSourceAnalysis } from '../../../source-analysis/run.js';

export interface ResolveCompositionRequest {
  signal?: AbortSignal;
  components: RawComponentDefinition[];
  sourceFiles: string[];
  sourceCapture?: SourceCapture;
  onProgress?: (event: ExtractAndComposeProgress) => void;
}

export interface ResolveCompositionResult extends ResolveCompositionServiceResult {
  /** Composition-enriched components (same input shape, mutated edges). */
  components: RawComponentDefinition[];
  /** Completion state carried into the selection handoff. */
  phase: 'done';
  /** Composition edge conflicts, if any. */
  conflicts: EdgeConflict[];
  /** User-visible deterministic mapping warnings and conflicts. */
  warnings: string[];
}

/**
 * Merge deterministic composition edges and retain lexical source observations
 * for downstream exploration. Source analysis runs in its cancellable worker.
 */
export async function resolveComposition(request: ResolveCompositionRequest): Promise<ResolveCompositionResult> {
  const { components, sourceFiles, sourceCapture, onProgress } = request;

  throwIfAborted(request.signal);
  const warnings: string[] = [];

  onProgress?.({ kind: 'composition', phase: 'resolving' });
  throwIfAborted(request.signal);

  const runtimeFiles = await readCompositionFiles(components, sourceFiles, sourceCapture);
  throwIfAborted(request.signal);

  const capturedPathsByComponent = new Map<string, Set<string>>();
  for (const file of sourceCapture?.files ?? []) {
    for (const ref of file.componentRefs) {
      if (!ref.roles.includes('definition')) continue;
      const identity = JSON.stringify([ref.componentId, ref.name]);
      const paths = capturedPathsByComponent.get(identity) ?? new Set<string>();
      paths.add(file.canonicalPath);
      capturedPathsByComponent.set(identity, paths);
    }
  }
  // Bind deterministic collectors to captured identities without changing public component source paths.
  const evidenceComponents = components.map((component) => {
    const identity = JSON.stringify([deriveComponentId(component.name, component.source), component.name]);
    const paths = capturedPathsByComponent.get(identity);
    return paths?.size === 1 ? { ...component, sourcePath: [...paths][0] } : component;
  });
  const { extraEdges, sourceCallSites } = await runSourceAnalysis(
    'composition',
    {
      files: runtimeFiles,
      components: evidenceComponents,
    },
    { signal: request.signal },
  );
  throwIfAborted(request.signal);
  const result = await resolveMapping({
    components,
    ...(extraEdges.length > 0 ? { extraEdges } : {}),
    sourceCallSiteEvidence: sourceCallSites.accepted,
    sourceCallSiteRejections: sourceCallSites.rejected,
    sourceCallSiteCoverage: sourceCallSites.coverage,
  });
  throwIfAborted(request.signal);

  onProgress?.({ kind: 'composition', phase: 'done' });

  for (const w of result.warnings) warnings.push(`composition — ${w}`);
  const conflicts: EdgeConflict[] = [];
  for (const c of result.conflicts) {
    warnings.push(`composition conflict on ${c.parent}→${c.child}: kept ${c.winner}, dropped ${c.loser}`);
    conflicts.push(c);
  }

  return {
    components: result.components as RawComponentDefinition[],
    phase: 'done',
    conflicts,
    warnings,
    sourceCallSiteEvidence: result.sourceCallSiteEvidence,
    sourceCallSiteRejections: result.sourceCallSiteRejections,
    sourceCallSiteCoverage: result.sourceCallSiteCoverage,
  };
}

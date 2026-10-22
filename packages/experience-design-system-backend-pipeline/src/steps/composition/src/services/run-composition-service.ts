import type { RawComponentDefinition } from '../../../extraction/src/types/component.js';
import { resolveMapping } from '../helpers/edges/resolve-mapping.js';
import { collectManifestDocEdges } from '../helpers/edges/manifest-doc-evidence.js';
import { collectSourceCallSiteEvidence } from '../helpers/edges/source-call-site-evidence.js';
import type { ResolveCompositionServiceOptions, ResolveCompositionServiceResult } from '../types/contract.js';

export async function runCompositionService(
  options: ResolveCompositionServiceOptions,
): Promise<ResolveCompositionServiceResult> {
  const { components, allFiles } = options;

  const componentNameSet = new Set(components.map((c) => c.name));
  const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));
  const manifestDocEdges = collectManifestDocEdges(runtimeFiles, components, componentNameSet);
  const sourceCallSites = collectSourceCallSiteEvidence(runtimeFiles, components);

  options.onProgress?.('resolving');
  const result = await resolveMapping({
    components,
    ...(manifestDocEdges.length > 0 ? { extraEdges: manifestDocEdges } : {}),
    sourceCallSiteEvidence: sourceCallSites.accepted,
    sourceCallSiteRejections: sourceCallSites.rejected,
    sourceCallSiteCoverage: sourceCallSites.coverage,
  });
  options.onProgress?.('done');

  for (const w of result.warnings) options.onWarning?.(`composition — ${w}`);
  for (const c of result.conflicts) {
    options.onWarning?.(`composition conflict on ${c.parent}→${c.child}: kept ${c.winner}, dropped ${c.loser}`);
  }

  return {
    components: result.components as RawComponentDefinition[],
    warnings: result.warnings,
    sourceCallSiteEvidence: result.sourceCallSiteEvidence,
    sourceCallSiteRejections: result.sourceCallSiteRejections,
    sourceCallSiteCoverage: result.sourceCallSiteCoverage,
  };
}

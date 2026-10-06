import type { RawComponentDefinition } from '../../types.js';
import { resolveMapping } from '../composition/resolve-mapping.js';
import { collectManifestDocEdges } from '../composition/manifest-doc-evidence.js';
import {
  collectSourceCallSiteEvidence,
  type SourceCallSiteEvidence,
  type SourceCallSiteRejection,
} from '../composition/source-call-site-evidence.js';

export interface CompositionMappingOptions {
  components: RawComponentDefinition[];
  allFiles: Array<{ path: string; content: string }>;
  onProgress?: (phase: string) => void;
}

export interface CompositionMappingResult {
  components: RawComponentDefinition[];
  warnings: string[];
  sourceCallSiteEvidence: SourceCallSiteEvidence[];
  sourceCallSiteRejections: SourceCallSiteRejection[];
}

export function resolveCompositionMapping(options: CompositionMappingOptions): CompositionMappingResult {
  const { components, allFiles } = options;

  const componentNameSet = new Set(components.map((c) => c.name));
  const runtimeFiles = allFiles.map((c) => ({ path: c.path, content: c.content }));
  const manifestDocEdges = collectManifestDocEdges(runtimeFiles, components, componentNameSet);
  const sourceCallSites = collectSourceCallSiteEvidence(runtimeFiles, components);

  options.onProgress?.('resolving');
  const result = resolveMapping({
    components,
    ...(manifestDocEdges.length > 0 ? { extraEdges: manifestDocEdges } : {}),
    sourceCallSiteEvidence: sourceCallSites.accepted,
    sourceCallSiteRejections: sourceCallSites.rejected,
  });
  options.onProgress?.('done');

  for (const w of result.warnings) process.stderr.write(`Warning: composition — ${w}\n`);
  for (const c of result.conflicts) {
    process.stderr.write(
      `Warning: composition conflict on ${c.parent}→${c.child}: kept ${c.winner}, dropped ${c.loser}\n`,
    );
  }

  return {
    components: result.components as RawComponentDefinition[],
    warnings: result.warnings,
    sourceCallSiteEvidence: sourceCallSites.accepted,
    sourceCallSiteRejections: sourceCallSites.rejected,
  };
}

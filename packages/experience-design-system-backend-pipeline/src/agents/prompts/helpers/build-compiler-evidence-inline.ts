import { SUPPORTED_SOURCE_FACT_SCHEMA_VERSIONS } from '../../../steps/extraction/index.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import type { ExtractionDiagnostics } from '../../../steps/extraction/index.js';

import { buildComponentEvidence } from './build-component-evidence.js';

export type CompilerEvidenceReadiness = 'ready' | 'caller-provided' | 'unavailable';

/** Serialize the same bounded candidate and run-diagnostic channel for selection and generation. */
export function buildCompilerEvidenceInline(
  components: readonly RawComponentDefinition[],
  options: {
    readiness: CompilerEvidenceReadiness;
    diagnostics?: ExtractionDiagnostics | null;
    diagnosticsStatus?: 'available' | 'absent' | 'corrupt' | 'unsupported';
    reason?: string;
  },
): string {
  const candidates = components.map((component) => {
    const readStatus = component.sourceEvidenceReadStatus;
    const allowedFromReadStatus = readStatus === undefined && options.readiness === 'caller-provided';
    const available =
      options.readiness !== 'unavailable' &&
      (readStatus === 'available' || allowedFromReadStatus) &&
      SUPPORTED_SOURCE_FACT_SCHEMA_VERSIONS.includes(component.factSchemaVersion as 3 | 4) &&
      component.sourceCandidates !== undefined;
    return {
      componentName: component.name,
      sourcePath: component.sourcePath ?? component.source,
      factSchemaVersion: component.factSchemaVersion ?? null,
      status: available
        ? 'available'
        : readStatus === 'corrupt' || readStatus === 'unsupported' || readStatus === 'unknown-legacy'
          ? readStatus
          : options.readiness === 'unavailable'
            ? 'unavailable'
            : 'unknown',
      candidates: available ? component.sourceCandidates : null,
      alternateSources: available ? (component.sourceCandidateSources ?? []) : null,
    };
  });
  const componentFacts = buildComponentEvidence(components, options.readiness);
  return JSON.stringify({
    schemaVersion: 1,
    readiness: options.readiness,
    ...(options.reason ? { reason: options.reason } : {}),
    sourceCandidates: candidates,
    componentFacts,
    compilerEvidence: {
      status: options.diagnosticsStatus ?? (options.diagnostics ? 'available' : 'absent'),
      runDiagnostics: options.diagnostics ?? null,
    },
  });
}

import type { SessionSourceEnvelope } from '../../../persistence/src/session/repositories/db.js';

type EvidenceFile = {
  fileId: string;
  compilerContextId?: string;
  path: string;
  textHash: string | null;
  roles: string[];
  componentRefs: SessionSourceEnvelope['capture']['files'][number]['componentRefs'];
  captured:
    | { kind: 'full' | 'excerpt'; startLine: number; endLine: number; text: string }
    | { kind: 'unavailable'; reason: string };
};

const SOURCE_HEADER =
  'Saved source evidence (bounded capture; advisory only, not compiler or execution proof):\n```json\n';
export function renderSelectionEvidenceInline(value: string): string {
  return `${SOURCE_HEADER}${value}\n\`\`\``;
}
/** Build a deterministic prompt projection from saved evidence, never from the current filesystem. */
export function buildSelectionEvidenceInline(envelope: SessionSourceEnvelope): string {
  const orderedFiles = [...envelope.capture.files].sort((left, right) =>
    left.displayPath.localeCompare(right.displayPath),
  );
  const observations = {
    accepted: envelope.observations.accepted,
    rejected: envelope.observations.rejected,
    acceptedOmitted: 0,
    rejectedOmitted: 0,
    ...(envelope.observations.callerCoverage
      ? { callerCoverage: structuredClone(envelope.observations.callerCoverage) }
      : {}),
    referenceIndexes: structuredClone(envelope.observations.referenceIndexes ?? []),
  };
  const payload = {
    readiness: envelope.readiness,
    captureId: envelope.capture.captureId,
    captureDigest: envelope.capture.digest,
    coverage: envelope.capture.coverage,
    promptCoverage: envelope.capture.coverage,
    ...(envelope.capture.compilerContexts
      ? { compilerContexts: structuredClone(envelope.capture.compilerContexts) }
      : {}),
    compilerContextsOmitted: 0,
    extractionByteBinding: envelope.extractionByteBinding,
    observations,
    referenceIndexesOmitted: 0,
    callerCoverageOmitted: 0,
    inventoryOmitted: 0,
    ...(envelope.capture.inventory
      ? {
          inventory: {
            ...envelope.capture.inventory,
            files: envelope.capture.inventory.files.map(({ text: _text, ...file }) => file),
            sourceMaps: envelope.capture.inventory.sourceMaps.map((map) => ({
              ...map,
              sources: map.sources.map(({ text: _text, ...source }) => source),
            })),
          },
        }
      : {}),
    resolution: envelope.capture.resolution,
    resolutionOmitted: 0,
    diagnostics: envelope.capture.diagnostics,
    diagnosticsOmitted: 0,
    files: [] as EvidenceFile[],
    filesOmitted: 0,
  };
  for (let index = 0; index < orderedFiles.length; index += 1) {
    const file = orderedFiles[index]!;
    const captured: EvidenceFile['captured'] =
      file.captured.kind === 'full'
        ? {
            kind: 'full',
            startLine: 1,
            endLine: file.captured.text.split('\n').length,
            text: file.captured.text,
          }
        : file.captured.kind === 'excerpts'
          ? {
              kind: 'excerpt',
              startLine: file.captured.ranges[0]?.startLine ?? 1,
              endLine: file.captured.ranges.at(-1)?.endLine ?? 1,
              text: file.captured.ranges.map((range) => range.text).join('\n'),
            }
          : { kind: 'unavailable', reason: file.captured.reason };
    const candidate: EvidenceFile = {
      fileId: file.fileId,
      ...(file.compilerContextId ? { compilerContextId: file.compilerContextId } : {}),
      path: file.displayPath,
      textHash: file.textHash,
      roles: file.roles,
      componentRefs: file.componentRefs,
      captured,
    };
    payload.files.push(candidate);
  }
  if (
    payload.promptCoverage === 'complete-within-declared-bound' &&
    orderedFiles.some((file) => file.captured.kind !== 'full')
  )
    payload.promptCoverage = 'partial';
  return JSON.stringify(payload, null, 2);
}

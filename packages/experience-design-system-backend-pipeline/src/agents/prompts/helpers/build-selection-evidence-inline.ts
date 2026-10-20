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
function byteLength(value: string): number {
  return Buffer.byteLength(renderSelectionEvidenceInline(value), 'utf8');
}

/** Build a deterministic prompt projection from saved evidence, never from the current filesystem. */
export function buildSelectionEvidenceInline(envelope: SessionSourceEnvelope): string {
  const limit = envelope.capture.bounds.limits.maxPromptBytes;
  const orderedFiles = [...envelope.capture.files].sort((left, right) =>
    left.displayPath.localeCompare(right.displayPath),
  );
  const observations = {
    accepted: envelope.observations.accepted.slice(0, 32),
    rejected: envelope.observations.rejected.slice(0, 32),
    acceptedOmitted: Math.max(0, envelope.observations.accepted.length - 32),
    rejectedOmitted: Math.max(0, envelope.observations.rejected.length - 32),
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
    resolution: envelope.capture.resolution.slice(0, 64),
    resolutionOmitted: Math.max(0, envelope.capture.resolution.length - 64),
    diagnostics: envelope.capture.diagnostics.slice(0, 32),
    diagnosticsOmitted: Math.max(0, envelope.capture.diagnostics.length - 32),
    files: [] as EvidenceFile[],
    filesOmitted: 0,
  };
  const serialize = (): string => JSON.stringify(payload, null, 2);
  // Preserve saved source bodies before spending their remaining bound on additive metadata.
  const omitAdditiveMetadata = (): boolean => {
    if (payload.inventory !== undefined) {
      delete payload.inventory;
      payload.inventoryOmitted++;
    } else if (observations.referenceIndexes.length) {
      observations.referenceIndexes.pop();
      payload.referenceIndexesOmitted++;
    } else if (observations.callerCoverage !== undefined) {
      delete observations.callerCoverage;
      payload.callerCoverageOmitted++;
    } else return false;
    payload.promptCoverage = 'partial';
    return true;
  };
  while (byteLength(serialize()) >= limit && omitAdditiveMetadata()) {
    // Each omission keeps its receipt in the bounded projection.
  }
  while (byteLength(serialize()) >= limit && payload.compilerContexts?.length) {
    payload.compilerContexts.pop();
    payload.compilerContextsOmitted++;
    payload.promptCoverage = 'partial';
  }
  const minimum = serialize();
  if (byteLength(minimum) >= limit) {
    const fallback = JSON.stringify({
      readiness: envelope.readiness,
      captureId: envelope.capture.captureId,
      captureDigest: envelope.capture.digest,
      coverage: envelope.capture.coverage,
      extractionByteBinding: envelope.extractionByteBinding,
      filesIncluded: 0,
      filesOmitted: envelope.capture.files.length,
      evidenceProjection: 'metadata-exceeds-prompt-bound',
      promptCoverage: 'partial',
      compilerContextsOmitted: envelope.capture.compilerContexts?.length ?? 0,
      referenceIndexesOmitted: envelope.observations.referenceIndexes?.length ?? 0,
      callerCoverageOmitted: envelope.observations.callerCoverage ? 1 : 0,
      inventoryOmitted: envelope.capture.inventory ? 1 : 0,
    });
    if (byteLength(fallback) > limit) throw new Error('Source identity metadata exceeds prompt bound');
    return fallback;
  }

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
    payload.filesOmitted = orderedFiles.length - payload.files.length;
    while (byteLength(serialize()) > limit && omitAdditiveMetadata()) {
      // Retry the complete source range before truncating any of its original lines.
    }
    if (byteLength(serialize()) <= limit) continue;
    payload.files.pop();
    payload.promptCoverage = 'partial';
    if (file.captured.kind === 'full') {
      const lines = file.captured.text.split('\n');
      let low = 0;
      let high = lines.length;
      let best: EvidenceFile | undefined;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const text = lines.slice(0, middle).join('\n');
        const excerpt: EvidenceFile = {
          ...candidate,
          captured: { kind: 'excerpt', startLine: 1, endLine: middle, text },
        };
        payload.files.push(excerpt);
        payload.filesOmitted = orderedFiles.length - payload.files.length;
        const fits = byteLength(serialize()) <= limit;
        payload.files.pop();
        if (fits && middle > 0) {
          best = excerpt;
          low = middle + 1;
        } else high = middle - 1;
      }
      if (best) {
        payload.files.push(best);
        payload.filesOmitted = orderedFiles.length - payload.files.length;
        break;
      }
    }
    payload.filesOmitted = orderedFiles.length - payload.files.length;
    break;
  }
  if (
    payload.filesOmitted ||
    payload.resolutionOmitted ||
    payload.diagnosticsOmitted ||
    observations.acceptedOmitted ||
    observations.rejectedOmitted
  )
    payload.promptCoverage = 'partial';
  if (byteLength(serialize()) > limit) throw new Error('Source identity metadata exceeds prompt bound');
  return serialize();
}

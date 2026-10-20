import type { ExplorationSourceInput, BoundSourceFile } from '@contentful/experience-design-system-types';
import type { SessionSourceEnvelope } from '../../../persistence/src/session/repositories/db.js';
export function buildExplorationSourceInput(
  envelope: SessionSourceEnvelope,
  maxBytes = 160 * 1024,
  compilerDiagnostics?: unknown,
): ExplorationSourceInput {
  const result: ExplorationSourceInput = {
    captureId: envelope.capture.captureId,
    captureDigest: envelope.capture.digest,
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.digest,
    coverage: envelope.capture.coverage,
    promptCoverage: envelope.capture.coverage,
    extractionByteBinding: envelope.extractionByteBinding,
    files: [],
    omittedFiles: 0,
    diagnostics: [
      ...envelope.capture.diagnostics,
      ...(compilerDiagnostics ? [{ kind: 'compiler-run', diagnostics: compilerDiagnostics }] : []),
    ],
    observations: envelope.observations,
  };
  for (const file of envelope.capture.files) {
    const ranges =
      file.captured.kind === 'full'
        ? [{ startLine: 1, endLine: file.captured.text.split('\n').length, text: file.captured.text }]
        : file.captured.kind === 'excerpts'
          ? file.captured.ranges
          : [];
    const projected: BoundSourceFile = {
      fileId: file.fileId,
      path: file.canonicalPath,
      textHash: file.textHash,
      ranges,
      coverage:
        file.captured.kind === 'full'
          ? 'complete-within-declared-bound'
          : file.captured.kind === 'excerpts'
            ? 'partial'
            : 'unavailable',
    };
    result.files.push(projected);
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) {
      result.files.pop();
      result.omittedFiles++;
      result.promptCoverage = 'partial';
    } else if (projected.coverage !== 'complete-within-declared-bound') result.promptCoverage = 'partial';
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) {
    result.omittedObservations = result.observations.accepted.length + result.observations.rejected.length;
    result.omittedDiagnostics = result.diagnostics.length;
    result.observations = { accepted: [], rejected: [] };
    result.diagnostics = [{ reason: 'Metadata omitted by prompt byte bound' }];
    result.promptCoverage = 'partial';
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes)
    throw new Error('Source identity metadata exceeds prompt bound');
  return result;
}

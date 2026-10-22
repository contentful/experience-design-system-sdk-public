import {
  canonicalSourceFactPath,
  mapInputOutputLocations,
  type SourceInputOutputEvidence,
} from '../../../../steps/extraction/index.js';
import type { CompletedSourceEvidence } from './db.js';

/** Saved labels are checked against the completed captured bytes and source ranges on every reopen. */
export function validateSavedInputOutput(
  evidence: SourceInputOutputEvidence,
  source: CompletedSourceEvidence,
  closureBound: boolean,
): SourceInputOutputEvidence {
  let invalid = false;
  const bound = mapInputOutputLocations(evidence, (location) => {
    const file =
      source.readiness === 'ready' && location.canonicalPath
        ? source.envelope.capture.files.find(
            (file) => file.canonicalPath === canonicalSourceFactPath(location.canonicalPath!),
          )
        : undefined;
    let binding: typeof location.binding = 'unavailable';
    if (closureBound && file && file.captured.kind === 'full' && file.textHash && location.textHash) {
      const text = file.captured.text;
      const start = location.startOffset;
      const end = location.endOffset;
      const range =
        start != null &&
        end != null &&
        start >= 0 &&
        end >= start &&
        end <= text.length &&
        location.startLine === text.slice(0, start).split('\n').length &&
        location.endLine === text.slice(0, end).split('\n').length;
      binding = file.textHash !== location.textHash ? 'changed' : range ? 'verified' : 'unavailable';
    }
    if (binding !== 'verified') invalid = true;
    return { ...location, fileId: file?.fileId ?? null, binding };
  });
  return invalid
    ? {
        ...bound,
        coverage: 'partial',
        summaries: bound.summaries.map((summary) => ({
          ...summary,
          state: 'open',
          reasons: [...new Set([...summary.reasons, 'saved-flow-binding-unavailable'])],
        })),
      }
    : bound;
}

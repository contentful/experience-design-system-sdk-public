import {
  canonicalSourceFactPath,
  mapReferenceIndexLocations,
  type SourceCapture,
  type SourceReferenceIndex,
} from '@contentful/experience-design-system-extraction';

/** Recheck every endpoint against the immutable completed bytes, including lexical owners and sample origins. */
export function bindSavedSourceReferences(
  index: SourceReferenceIndex,
  files: SourceCapture['files'],
): SourceReferenceIndex {
  let invalid = false;
  const bound = mapReferenceIndexLocations(index, (location) => {
    const file = location.canonicalPath
      ? files.find((file) => file.canonicalPath === canonicalSourceFactPath(location.canonicalPath!))
      : undefined;
    let binding: typeof location.binding = 'unavailable';
    if (file?.captured.kind === 'full' && file.textHash && location.textHash) {
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
          reasons: [...new Set([...summary.reasons, 'saved-reference-binding-unavailable'])],
        })),
        omissions: [...bound.omissions, { reason: 'saved-reference-binding-unavailable', location: null, count: 1 }],
      }
    : bound;
}

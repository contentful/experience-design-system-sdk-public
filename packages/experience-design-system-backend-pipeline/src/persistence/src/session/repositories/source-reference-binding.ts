import {
  mapReferenceIndexLocations,
  type SourceCapture,
  type SourceReferenceIndex,
} from '../../../../steps/extraction/index.js';
import { createCapturedLocationBinder } from './captured-file-lookup.js';

/** Recheck every endpoint against the immutable completed bytes, including lexical owners and sample origins. */
export function bindSavedSourceReferences(
  index: SourceReferenceIndex,
  files: SourceCapture['files'],
): SourceReferenceIndex {
  let invalid = false;
  const bindLocation = createCapturedLocationBinder(files);
  const bound = mapReferenceIndexLocations(index, (location) => {
    const rebound = bindLocation(location);
    if (rebound.binding !== 'verified') invalid = true;
    return rebound;
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

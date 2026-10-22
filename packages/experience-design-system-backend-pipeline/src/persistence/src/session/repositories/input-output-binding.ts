import { mapInputOutputLocations, type SourceInputOutputEvidence } from '../../../../steps/extraction/index.js';
import type { CompletedSourceEvidence } from './db.js';
import { createCapturedLocationBinder } from './captured-file-lookup.js';

/** Saved labels are checked against the completed captured bytes and source ranges on every reopen. */
export function validateSavedInputOutput(
  evidence: SourceInputOutputEvidence,
  source: CompletedSourceEvidence,
  componentBound: boolean,
): SourceInputOutputEvidence {
  let invalid = false;
  const bindLocation = createCapturedLocationBinder(source.readiness === 'ready' ? source.envelope.capture.files : []);
  const bound = mapInputOutputLocations(evidence, (location) => {
    const rebound = bindLocation(location);
    const binding = componentBound ? rebound.binding : 'unavailable';
    if (binding !== 'verified') invalid = true;
    return { ...rebound, binding };
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

import { sourceClosureIdentity } from '../../source-closure/source-evidence.js';
import type { ComponentSourceObservationCollection } from '../types/component-source-observations.js';

/** Local input ownership requires the captured component declaration, independently of closure completeness. */
export function hasBoundComponentDeclaration(observations: ComponentSourceObservationCollection): boolean {
  return observations.observations.some(
    (observation) =>
      observation.kind === 'declaration' &&
      observation.certainty === 'certain' &&
      observation.location.binding === 'verified' &&
      sourceClosureIdentity(observation.location) === observations.componentDeclarationId,
  );
}

import type { ExploreRepresentationProposalSource } from '../types.js';
import { assertUnique } from './identity.js';

/** Retain source graphs and gaps for exact owners without transporting inferred target decisions. */
export function propertySourceEvidence(
  sources?: readonly ExploreRepresentationProposalSource[],
  owners?: readonly { component: string; source: string }[],
) {
  if (!sources) return;
  const key = (owner: { component: string; source: string }) => JSON.stringify([owner.component, owner.source]);
  assertUnique(sources.map(key), 'property evidence source owners');
  const wanted = owners ? new Set(owners.map(key)) : undefined;
  return {
    coverage: 'supplied-source-only',
    missingOwners: owners?.filter((owner) => !sources.some((source) => key(source) === key(owner))) ?? [],
    components: sources
      .filter((source) => !wanted || wanted.has(key(source)))
      .map(({ component, source, properties }) => ({
        component,
        source,
        properties: properties.map(({ identity, source }) => ({ identity, source })),
      })),
  };
}

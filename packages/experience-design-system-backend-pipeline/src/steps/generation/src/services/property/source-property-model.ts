import { cloneJson, type PropertyModel, type JsonValue } from '@contentful/experience-design-system-types';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';

/** Build source evidence independently of category and representation decisions. */
export function sourcePropertyModel(
  component: RawComponentDefinition,
  propertyName: string,
  componentId = component.name,
): PropertyModel | undefined {
  const candidate = component.sourceCandidates?.find((item) => item.name === propertyName);
  const fact = candidate?.facts;
  if (!fact?.sourceGraph) return;
  const sourceRevision = [
    ...new Set(
      [
        ...fact.declarations,
        ...fact.sourceGraph.nodes.flatMap((node) => [
          ...node.declarations,
          ...(node.fields?.flatMap((field) => field.declarations ?? []) ?? []),
        ]),
      ].map((location) => `${location.canonicalPath ?? ''}:${location.textHash ?? ''}`),
    ),
  ]
    .sort()
    .join('|');
  return {
    identity: {
      componentId,
      propertyId: JSON.stringify([componentId, propertyName]),
      key: propertyName,
      sourceRevision,
      nodeId: fact.sourceGraph.rootId,
    },
    source: {
      typeText: fact.sourceTypeText,
      graph: cloneJson(fact.sourceGraph),
      shape: cloneJson(fact.advisoryShape),
      ...(fact.sourceDefault ? { default: cloneJson(fact.sourceDefault) } : {}),
      observations: [],
      useEvidence: (component.componentFacts?.sourceObservations?.inputOutput?.witnesses ?? [])
        .filter((witness) => witness.inputName === propertyName)
        .map((witness) => ({
          reference: witness.id,
          status:
            witness.context === 'returned' && witness.strength === 'exact'
              ? ('output-flow-found' as const)
              : ('unresolved' as const),
        })),
      originalFacts: cloneJson(candidate) as unknown as JsonValue,
    },
    defaultIntent: { action: 'absent' },
  };
}

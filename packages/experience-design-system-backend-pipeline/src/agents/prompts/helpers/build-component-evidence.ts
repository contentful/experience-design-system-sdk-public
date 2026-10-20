import type { ComponentFacts, ComponentEvidenceReadStatus } from '@contentful/experience-design-system-extraction';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import { readComponentFacts } from '../../../persistence/src/session/repositories/component-facts-validation.js';

export interface ComponentEvidenceEntry {
  componentName: string;
  sourcePath: string;
  status: ComponentEvidenceReadStatus | 'unknown' | 'unavailable';
  facts: ComponentFacts | null;
}

export function buildComponentEvidence(
  components: readonly RawComponentDefinition[],
  readiness: 'ready' | 'caller-provided' | 'unavailable',
): ComponentEvidenceEntry[] {
  return components.map((component) => {
    const read = readComponentFacts(component.componentFacts);
    const savedStatus = component.componentEvidenceReadStatus;
    const allowed = savedStatus === 'available' || (savedStatus === undefined && readiness === 'caller-provided');
    const status =
      readiness === 'unavailable'
        ? 'unavailable'
        : savedStatus && savedStatus !== 'available'
          ? savedStatus
          : allowed
            ? read.status
            : 'unknown';
    return {
      componentName: component.name,
      sourcePath: component.sourcePath ?? component.source,
      status,
      facts: status === 'available' ? read.facts! : null,
    };
  });
}

/** Count only validated available observations when withholding candidate-free hints. */
export function countComponentObservations(entries: readonly ComponentEvidenceEntry[]): number {
  return entries.reduce((count, entry) => {
    const facts = entry.facts;
    return (
      count +
      (facts?.sourceObservations?.observations.length ?? 0) +
      (facts?.renderables?.length ?? 0) +
      (facts?.members?.length ?? 0) +
      (facts?.childFilters?.length ?? 0) +
      (facts?.requiresParent?.length ?? 0) +
      (facts?.nonStatic?.length ?? 0) +
      (facts?.referencedOrigins?.length ?? 0) +
      (facts?.origin ? 1 : 0)
    );
  }, 0);
}

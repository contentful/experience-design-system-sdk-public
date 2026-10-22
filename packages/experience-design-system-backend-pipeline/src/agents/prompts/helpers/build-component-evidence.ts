import type { ComponentFacts, ComponentEvidenceReadStatus } from '../../../steps/extraction/index.js';
import type { RawComponentDefinition } from '../../../steps/extraction/src/types/component.js';
import { readComponentFacts } from '../../../persistence/src/session/repositories/component-facts-validation.js';
import {
  assessFieldApplicability,
  type FieldProjectionPreview,
} from '../../../steps/extraction/src/component-facts/assess-field-applicability.js';

export interface ComponentEvidenceEntry {
  componentName: string;
  sourcePath: string;
  status: ComponentEvidenceReadStatus | 'unknown' | 'unavailable';
  facts: ComponentFacts | null;
  fieldProjectionPreview?: FieldProjectionPreview;
  fieldSemanticsPolicy?: {
    claims: 'conditional-advisory';
    replay: 'source-reproduction-only';
    runtimeAndDeliveryApplicability: 'unestablished';
    schemaChanges: 'not-authorized';
  };
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
      ...(status === 'available' && read.facts?.sourceObservations?.fieldSemantics?.relationalReplay
        ? {
            fieldProjectionPreview: assessFieldApplicability(
              read.facts.sourceObservations.fieldSemantics.relationalReplay,
            ),
            fieldSemanticsPolicy: {
              claims: 'conditional-advisory' as const,
              replay: 'source-reproduction-only' as const,
              runtimeAndDeliveryApplicability: 'unestablished' as const,
              schemaChanges: 'not-authorized' as const,
            },
          }
        : {}),
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

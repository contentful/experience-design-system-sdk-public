import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../../../../types.js';
import type { RawComponentRow } from '../../../repositories/components/raw/interfaces/raw-component-row.js';
import { parseReviewReasons } from '../../../repositories/components/raw/row-mappers.js';

export type RawComponentWithId = RawComponentDefinition & {
  component_id: string;
};

// Pure component-row → RawComponentWithId mapper. The props and slots
// are passed in already-mapped (rather than raw rows + join tables) so
// this file stays pure and free of the row-indexing concerns handled
// by the composer.
export function mapRawComponentToWithId(
  row: RawComponentRow,
  props: RawPropDefinition[],
  slots: RawSlotDefinition[],
): RawComponentWithId {
  return {
    component_id: row.component_id,
    name: row.name,
    source: row.source,
    framework: row.framework as RawComponentDefinition['framework'],
    extractionConfidence: row.extraction_confidence ?? null,
    reviewReasons: parseReviewReasons(row.review_reasons),
    needsReview: Boolean(row.needs_review),
    sourcePath: row.source_path ?? undefined,
    props,
    slots,
  };
}

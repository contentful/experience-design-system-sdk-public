import { readFile } from 'node:fs/promises';
import type { RawComponentDefinition } from '../../../../types/component.js';
import type { ComponentSourceInspection } from '../../../../types/source-inspection.js';
import {
  DATA_WRAPPER_REASON_PREFIX,
  GENERATED_IMPORT_PATTERN,
  GENERATED_QUERY_HOOK_PATTERN,
  GQL_FILENAME_PATTERN,
  LOADING_NULL_GUARD_PATTERN,
  collectSiblingRendererImports,
  hasSiblingForwardRender,
  hasVisibleUiRender,
  collectInfraPropNames,
  mapScoreToWrapperConfidence,
  dedupeStrings,
} from './data-wrapper-signals.js';

export type { ComponentSourceInspection } from '../../../../types/source-inspection.js';

export const HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON = 'data-fetch-wrapper';
export const POSSIBLE_DATA_FETCH_WRAPPER_REASON = 'possible-data-fetch-wrapper';
export const ZERO_SURFACE_RENDERED_UI_REASON = 'zero-surface:rendered-ui';

export async function inspectComponentSource(component: RawComponentDefinition): Promise<ComponentSourceInspection> {
  let sourceText = '';
  try {
    sourceText = await readFile(component.source, 'utf8');
  } catch {
    return { wrapperConfidence: 0, reviewReasons: [], keepDespiteZeroSurface: false };
  }

  const reviewReasons: string[] = [];
  let wrapperScore = 0;

  const hasGeneratedQueryHook =
    GENERATED_IMPORT_PATTERN.test(sourceText) && GENERATED_QUERY_HOOK_PATTERN.test(sourceText);
  const infraProps = collectInfraPropNames(component);
  const siblingImports = collectSiblingRendererImports(sourceText);

  if (GQL_FILENAME_PATTERN.test(component.source)) {
    reviewReasons.push('data-wrapper:gql-filename');
    wrapperScore += 1;
  }

  if (hasGeneratedQueryHook) {
    reviewReasons.push('data-wrapper:generated-query-hook');
    wrapperScore += 3;
  }

  // Require corroboration from a stronger signal before counting sibling imports —
  // otherwise any composed component that imports two sub-components scores +1 here.
  if (siblingImports.length > 0 && (hasGeneratedQueryHook || infraProps.length > 0)) {
    reviewReasons.push('data-wrapper:sibling-renderer-import');
    wrapperScore += 1;
  }

  if (hasSiblingForwardRender(sourceText, siblingImports)) {
    reviewReasons.push('data-wrapper:fetch-forward-render');
    wrapperScore += 3;
  }

  if (sourceText.includes('useContentfulLiveUpdates(') || sourceText.includes('useContentfulContext(')) {
    reviewReasons.push('data-wrapper:contentful-runtime');
    wrapperScore += 1;
  }

  if (infraProps.length > 0) {
    reviewReasons.push('data-wrapper:infra-props');
    wrapperScore += 2;
  }

  if (LOADING_NULL_GUARD_PATTERN.test(sourceText)) {
    reviewReasons.push('data-wrapper:loading-null-guard');
    wrapperScore += 1;
  }

  const wrapperConfidence = mapScoreToWrapperConfidence(wrapperScore);
  if (wrapperConfidence >= 4) {
    reviewReasons.unshift(HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON);
  } else if (wrapperConfidence === 3) {
    reviewReasons.unshift(POSSIBLE_DATA_FETCH_WRAPPER_REASON);
  }

  const keepDespiteZeroSurface =
    component.props.length === 0 && component.slots.length === 0 && hasVisibleUiRender(sourceText);

  if (keepDespiteZeroSurface) {
    reviewReasons.push(ZERO_SURFACE_RENDERED_UI_REASON);
  }

  return {
    wrapperConfidence,
    reviewReasons: dedupeStrings(reviewReasons),
    keepDespiteZeroSurface,
  };
}

export function isDataWrapperReviewReason(reason: string): boolean {
  return (
    reason === HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON ||
    reason === POSSIBLE_DATA_FETCH_WRAPPER_REASON ||
    reason.startsWith(DATA_WRAPPER_REASON_PREFIX)
  );
}

export function describeReviewReason(reason: string): string {
  switch (reason) {
    case HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON:
      return 'high-confidence data-fetch wrapper';
    case POSSIBLE_DATA_FETCH_WRAPPER_REASON:
      return 'possible data-fetch wrapper';
    case 'data-wrapper:gql-filename':
      return 'source file follows a gql wrapper naming pattern';
    case 'data-wrapper:generated-query-hook':
      return 'imports and calls a generated query hook';
    case 'data-wrapper:sibling-renderer-import':
      return 'imports a sibling renderer from the same folder';
    case 'data-wrapper:fetch-forward-render':
      return 'forwards fetched data into a sibling renderer';
    case 'data-wrapper:contentful-runtime':
      return 'uses Contentful runtime hooks';
    case 'data-wrapper:infra-props':
      return 'only exposes infra-fetch props';
    case 'data-wrapper:loading-null-guard':
      return 'returns early while loading or when fetched data is missing';
    case ZERO_SURFACE_RENDERED_UI_REASON:
      return 'source renders visible/compositional UI despite zero extracted props and slots';
    default:
      return reason;
  }
}

export function describeReviewReasons(reasons: string[]): string[] {
  return dedupeStrings(reasons.map(describeReviewReason));
}

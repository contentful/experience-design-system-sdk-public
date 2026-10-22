import ts from 'typescript';
import type { RawComponentDefinition } from '../../../../types/component.js';
import type { ComponentSourceInspection } from '../../../../types/source-inspection.js';
import {
  HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON,
  POSSIBLE_DATA_FETCH_WRAPPER_REASON,
  ZERO_SURFACE_RENDERED_UI_REASON,
} from '../../../../constants/review-reasons.js';

export type { ComponentSourceInspection } from '../../../../types/source-inspection.js';
export {
  HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON,
  POSSIBLE_DATA_FETCH_WRAPPER_REASON,
  ZERO_SURFACE_RENDERED_UI_REASON,
};

function containsReturnedMarkup(expression: string): boolean {
  const source = ts.createSourceFile(
    'expression.tsx',
    `(${expression})`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const statement = source.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return false;
  function placed(node: ts.Expression): boolean {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
      return placed(node.expression);
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return true;
    if (ts.isConditionalExpression(node)) return placed(node.whenTrue) || placed(node.whenFalse);
    if (ts.isArrayLiteralExpression(node))
      return node.elements.some((element) => !ts.isSpreadElement(element) && placed(element));
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
        node.operatorToken.kind,
      )
    )
      return (
        placed(node.right) || (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken && placed(node.left))
      );
    return false;
  }
  return placed(statement.expression);
}

/** Captured component observations inform review; naming and familiar calls do not establish behavioral roles. */
export function inspectComponentSource(component: RawComponentDefinition): Promise<ComponentSourceInspection> {
  const observations = component.componentFacts?.sourceObservations?.observations ?? [];
  const keepDespiteZeroSurface =
    component.props.length === 0 &&
    component.slots.length === 0 &&
    observations.some(
      (observation) =>
        observation.kind === 'return' &&
        observation.context.execution === 'component-body' &&
        observation.operands?.some((operand) => operand.role === 'value' && containsReturnedMarkup(operand.expression)),
    );
  return Promise.resolve({
    wrapperConfidence: 0,
    reviewReasons: keepDespiteZeroSurface ? [ZERO_SURFACE_RENDERED_UI_REASON] : [],
    keepDespiteZeroSurface,
  });
}

export function isDataWrapperReviewReason(reason: string): boolean {
  return (
    reason === HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON ||
    reason === POSSIBLE_DATA_FETCH_WRAPPER_REASON ||
    reason.startsWith('data-wrapper:')
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
      return 'captured component source includes returned markup without extracted props or slots';
    default:
      return reason;
  }
}

export function describeReviewReasons(reasons: string[]): string[] {
  return [...new Set(reasons.map(describeReviewReason))];
}

import {
  SyntaxKind,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
} from 'ts-morph';
import { isIntrinsicJsxElement } from '../../../framework-adapters/shared/helpers/tsx-shared.js';
import { getReturnedJsxTagName, isJsxCarryingTypeText } from './get-jsx-ast-data.js';

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

export function collectRenderedComponentReferences(
  funcNode: FunctionLike,
  componentNames: ReadonlySet<string>,
  ownComponentName: string,
): string[] {
  const found = new Set<string>();
  const jsxElements = [
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
  ];
  for (const jsxElement of jsxElements) {
    const tagName = jsxElement.getTagNameNode().getText();
    if (isIntrinsicJsxElement(tagName)) continue;
    if (tagName === ownComponentName) continue;
    if (!componentNames.has(tagName)) continue;
    found.add(tagName);
  }
  return [...found].sort();
}

export function collectArrayMapRenderComponentReferences(
  funcNode: FunctionLike,
  componentNames: ReadonlySet<string>,
  ownComponentName: string,
  propTypesByName: ReadonlyMap<string, string>,
): string[] {
  const found = new Set<string>();
  const propNames = new Set(propTypesByName.keys());

  const renderCountByComponent = new Map<string, number>();
  for (const jsxElement of [
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
  ]) {
    const tagName = jsxElement.getTagNameNode().getText();
    if (isIntrinsicJsxElement(tagName) || tagName === ownComponentName || !componentNames.has(tagName)) continue;
    renderCountByComponent.set(tagName, (renderCountByComponent.get(tagName) ?? 0) + 1);
  }

  for (const callExpr of funcNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = callExpr.getExpression();
    if (!callee.isKind(SyntaxKind.PropertyAccessExpression)) continue;
    if (callee.getName() !== 'map') continue;

    const receiver = callee.getExpression();
    if (!receiver.isKind(SyntaxKind.Identifier)) continue;
    const propName = receiver.getText();
    if (!propNames.has(propName)) continue;

    const propTypeText = propTypesByName.get(propName) ?? '';
    if (isJsxCarryingTypeText(propTypeText)) continue;

    const [callbackArg] = callExpr.getArguments();
    if (!callbackArg) continue;
    if (!callbackArg.isKind(SyntaxKind.ArrowFunction) && !callbackArg.isKind(SyntaxKind.FunctionExpression)) continue;

    const returnedJsxTag = getReturnedJsxTagName(callbackArg);
    if (!returnedJsxTag || returnedJsxTag === ownComponentName || !componentNames.has(returnedJsxTag)) continue;
    if ((renderCountByComponent.get(returnedJsxTag) ?? 0) !== 1) continue;

    found.add(returnedJsxTag);
  }

  return [...found].sort();
}

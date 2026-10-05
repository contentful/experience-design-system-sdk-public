import { Node, SyntaxKind, type ParameterDeclaration } from 'ts-morph';
import type { FunctionLike } from '../function-resolution.js';
import { collectRestBindingNames, isComponentSpreadAttribute, inferPrimitiveDomPropsFromImplementation } from './infer-primitive-dom-props.js';

export { collectRestBindingNames, isComponentSpreadAttribute, inferPrimitiveDomPropsFromImplementation };

export function hasImplementationChildrenHint(funcNode: FunctionLike, param: ParameterDeclaration): boolean {
  const nameNode = param.getNameNode();
  const body = funcNode.getBody();
  if (!body) return false;

  if (Node.isObjectBindingPattern(nameNode)) {
    for (const element of nameNode.getElements()) {
      if (element.getNameNode().getText() === 'children') return true;
    }

    const restBindingNames = collectRestBindingNames(nameNode);
    if (restBindingNames.size === 0) return false;

    return body
      .getDescendantsOfKind(SyntaxKind.JsxSpreadAttribute)
      .some((attr) => isComponentSpreadAttribute(attr, restBindingNames));
  }

  if (!Node.isIdentifier(nameNode)) return false;

  const paramName = nameNode.getText();
  if (
    body
      .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
      .some((expr) => expr.getExpression().getText() === paramName && expr.getName() === 'children')
  ) {
    return true;
  }

  return body
    .getDescendantsOfKind(SyntaxKind.JsxSpreadAttribute)
    .some((attr) => isComponentSpreadAttribute(attr, new Set([paramName])));
}

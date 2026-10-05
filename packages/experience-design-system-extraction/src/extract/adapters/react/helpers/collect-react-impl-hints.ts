import { Node, SyntaxKind, type ParameterDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { getJsxTagNameNode } from '../../support/tsx-shared.js';
import {
  getDomAttributeSurface,
  JSX_PRIMITIVE_DOM_ATTRIBUTE_SURFACES,
  getBoundedImportedJsxDomSurface,
  type ExpandableDomAttributeWrapperName,
} from './dom-attribute-surfaces.js';
import type { FunctionLike } from '../function-resolution.js';

export function collectRestBindingNames(nameNode: Node): Set<string> {
  const names = new Set<string>();
  if (!Node.isObjectBindingPattern(nameNode)) return names;

  for (const element of nameNode.getElements()) {
    if (!element.getDotDotDotToken()) continue;
    const restNameNode = element.getNameNode();
    if (Node.isIdentifier(restNameNode)) names.add(restNameNode.getText());
  }

  return names;
}

export function isComponentSpreadAttribute(attribute: Node, bindingNames: Set<string>): boolean {
  if (!Node.isJsxSpreadAttribute(attribute)) return false;

  const expression = attribute.getExpression();
  if (!Node.isIdentifier(expression) || !bindingNames.has(expression.getText())) return false;

  const tagName = getJsxTagNameNode(attribute)?.getText();
  return tagName ? /^[A-Z]/.test(tagName) : false;
}

export function inferPrimitiveDomPropsFromImplementation(
  funcNode: FunctionLike,
  propsParam: ParameterDeclaration,
): RawPropDefinition[] {
  const candidatePropNames = new Set<string>();

  const propsParamNameNode = propsParam.getNameNode();
  if (Node.isIdentifier(propsParamNameNode)) candidatePropNames.add(propsParam.getName());

  for (const restName of collectRestBindingNames(propsParamNameNode)) candidatePropNames.add(restName);

  for (const variableDeclaration of funcNode.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = variableDeclaration.getInitializer();
    if (!initializer || !Node.isIdentifier(initializer) || !candidatePropNames.has(initializer.getText())) continue;

    const nameNode = variableDeclaration.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) continue;

    for (const restName of collectRestBindingNames(nameNode)) candidatePropNames.add(restName);
  }

  if (candidatePropNames.size === 0) return [];

  const inferredSurfaces = new Set<ExpandableDomAttributeWrapperName>();
  const jsxElements = [
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
  ];

  for (const jsxElement of jsxElements) {
    const tagNameNode = jsxElement.getTagNameNode();
    const domSurface =
      JSX_PRIMITIVE_DOM_ATTRIBUTE_SURFACES[tagNameNode.getText()] ?? getBoundedImportedJsxDomSurface(tagNameNode);
    if (!domSurface) continue;

    const hasForwardedPropsSpread = jsxElement
      .getAttributes()
      .some(
        (attribute) =>
          Node.isJsxSpreadAttribute(attribute) &&
          Node.isIdentifier(attribute.getExpression()) &&
          candidatePropNames.has(attribute.getExpression().getText()),
      );

    if (hasForwardedPropsSpread) inferredSurfaces.add(domSurface);
  }

  const propsByName = new Map<string, RawPropDefinition>();
  for (const surface of inferredSurfaces) {
    for (const prop of getDomAttributeSurface(surface)) {
      propsByName.set(prop.name, prop);
    }
  }

  return [...propsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

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

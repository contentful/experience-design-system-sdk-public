import { Node, SyntaxKind, type ParameterDeclaration } from 'ts-morph';
import {
  getJsxTagNameNode,
  getNodeDefinitions,
  getValueTargetDeclarations,
  isIntrinsicJsxElement,
} from '../../shared/helpers/tsx-shared.js';
import { resolveFunctionNode, type FunctionLike } from './resolve-component-function.js';

export type PropForwardingEdge = {
  sourceProp: string;
  targetComponentIdentity: string;
  targetProp: string;
};

export type PropDataflow = {
  intrinsicDomProps: Set<string>;
  componentEdges: PropForwardingEdge[];
};

type PropObjectShape = Map<string, string>;

function getDeclarationIdentity(node: Node): Node {
  if (Node.isIdentifier(node)) {
    const parent = node.getParent();
    if (
      (Node.isVariableDeclaration(parent) || Node.isBindingElement(parent) || Node.isParameterDeclaration(parent)) &&
      parent.getNameNode() === node
    ) {
      return parent;
    }
  }

  return getNodeDefinitions(node)[0]?.getDeclarationNode() ?? node;
}

export function getComponentIdentity(func: FunctionLike): string {
  return `${func.getSourceFile().getFilePath()}:${func.getStart()}`;
}

function resolveForwardedComponentIdentity(tagNameNode: Node): string | undefined {
  if (!Node.isIdentifier(tagNameNode)) return undefined;

  for (const declaration of getValueTargetDeclarations(tagNameNode)) {
    const func = resolveFunctionNode(declaration);
    if (func) return getComponentIdentity(func);
  }

  return undefined;
}

/**
 * Declarations that are rebound somewhere in the body, so their initializer no
 * longer describes the value that reaches JSX.
 */
function collectReboundDeclarations(body: Node | undefined): Set<Node> {
  const rebound = new Set<Node>();
  const recordTarget = (target: Node): void => {
    if (Node.isIdentifier(target)) {
      rebound.add(getDeclarationIdentity(target));
      return;
    }
    if (
      (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) &&
      Node.isIdentifier(target.getExpression())
    ) {
      rebound.add(getDeclarationIdentity(target.getExpression()));
    }
  };

  for (const assignment of body?.getDescendantsOfKind(SyntaxKind.BinaryExpression) ?? []) {
    // Covers `=` and every compound form (`+=`, `??=`, `>>>=`, ...).
    const operator = assignment.getOperatorToken().getKind();
    if (operator < SyntaxKind.FirstAssignment || operator > SyntaxKind.LastAssignment) continue;
    recordTarget(assignment.getLeft());
  }
  // Only `++`/`--` rebind the operand. Reading a prop through `!`, `-`, `+`, or
  // `~` leaves the alias intact, so those operators must not invalidate it.
  for (const update of body?.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression) ?? []) {
    const operator = update.getOperatorToken();
    if (operator !== SyntaxKind.PlusPlusToken && operator !== SyntaxKind.MinusMinusToken) continue;
    recordTarget(update.getOperand());
  }
  for (const update of body?.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression) ?? []) {
    recordTarget(update.getOperand());
  }

  return rebound;
}

/** Trace only statically resolvable, component-local prop dataflow into JSX. */
export function collectPropDataflow(
  func: FunctionLike,
  param: ParameterDeclaration,
  availablePropNames: Set<string>,
): PropDataflow {
  const valueAliases = new Map<Node, string>();
  const objectAliases = new Map<Node, PropObjectShape>();
  const fullPropsShape = new Map([...availablePropNames].map((name) => [name, name]));
  const belongsToComponentFunction = (node: Node): boolean =>
    node.getFirstAncestor(
      (ancestor) =>
        Node.isFunctionDeclaration(ancestor) || Node.isArrowFunction(ancestor) || Node.isFunctionExpression(ancestor),
    ) === func;

  const resolveValue = (expression: Node | undefined): string | undefined => {
    if (!expression) return undefined;
    if (Node.isParenthesizedExpression(expression)) return resolveValue(expression.getExpression());
    if (Node.isIdentifier(expression)) return valueAliases.get(getDeclarationIdentity(expression));
    if (Node.isPropertyAccessExpression(expression)) {
      const object = expression.getExpression();
      return Node.isIdentifier(object)
        ? objectAliases.get(getDeclarationIdentity(object))?.get(expression.getName())
        : undefined;
    }
    if (Node.isElementAccessExpression(expression)) {
      const argument = expression.getArgumentExpression();
      if (!argument || (!Node.isStringLiteral(argument) && !Node.isNoSubstitutionTemplateLiteral(argument))) {
        return undefined;
      }
      const object = expression.getExpression();
      return Node.isIdentifier(object)
        ? objectAliases.get(getDeclarationIdentity(object))?.get(argument.getLiteralText())
        : undefined;
    }
    return undefined;
  };

  const resolveObject = (expression: Node | undefined): PropObjectShape | undefined => {
    if (!expression) return undefined;
    if (Node.isParenthesizedExpression(expression)) return resolveObject(expression.getExpression());
    if (Node.isIdentifier(expression)) return objectAliases.get(getDeclarationIdentity(expression));
    if (!Node.isObjectLiteralExpression(expression)) return undefined;

    const shape: PropObjectShape = new Map();
    for (const property of expression.getProperties()) {
      if (Node.isSpreadAssignment(property)) {
        const spreadShape = resolveObject(property.getExpression());
        for (const [targetProp, sourceProp] of spreadShape ?? []) shape.set(targetProp, sourceProp);
      } else if (Node.isShorthandPropertyAssignment(property)) {
        const sourceProp = resolveValue(property.getNameNode());
        if (sourceProp) shape.set(property.getName(), sourceProp);
      } else if (Node.isPropertyAssignment(property)) {
        const propertyNameNode = property.getNameNode();
        if (!Node.isIdentifier(propertyNameNode) && !Node.isStringLiteral(propertyNameNode)) continue;
        const sourceProp = resolveValue(property.getInitializer());
        if (sourceProp) shape.set(property.getName(), sourceProp);
      }
    }
    return shape;
  };

  const addBindings = (pattern: import('ts-morph').ObjectBindingPattern, sourceShape: PropObjectShape): void => {
    const omittedProps = new Set(
      pattern
        .getElements()
        .filter((element) => !element.getDotDotDotToken())
        .map((element) => element.getPropertyNameNode()?.getText() ?? element.getNameNode().getText()),
    );

    for (const element of pattern.getElements()) {
      const localName = element.getNameNode();
      if (!Node.isIdentifier(localName)) continue;
      if (element.getDotDotDotToken()) {
        objectAliases.set(
          getDeclarationIdentity(localName),
          new Map([...sourceShape].filter(([targetProp]) => !omittedProps.has(targetProp))),
        );
        continue;
      }
      const targetProp = element.getPropertyNameNode()?.getText() ?? localName.getText();
      const sourceProp = sourceShape.get(targetProp);
      if (sourceProp) valueAliases.set(getDeclarationIdentity(localName), sourceProp);
    }
  };

  const paramNameNode = param.getNameNode();
  if (Node.isIdentifier(paramNameNode)) objectAliases.set(getDeclarationIdentity(paramNameNode), fullPropsShape);
  else if (Node.isObjectBindingPattern(paramNameNode)) addBindings(paramNameNode, fullPropsShape);

  const body = func.getBody();
  const reboundDeclarations = collectReboundDeclarations(body);
  for (const declaration of reboundDeclarations) {
    valueAliases.delete(declaration);
    objectAliases.delete(declaration);
  }

  for (const declaration of body?.getDescendantsOfKind(SyntaxKind.VariableDeclaration) ?? []) {
    if (!belongsToComponentFunction(declaration)) continue;

    const initializer = declaration.getInitializer();
    const declarationName = declaration.getNameNode();
    if (Node.isIdentifier(declarationName)) {
      const aliasDeclaration = getDeclarationIdentity(declarationName);
      if (reboundDeclarations.has(aliasDeclaration)) continue;
      const sourceProp = resolveValue(initializer);
      if (sourceProp) valueAliases.set(aliasDeclaration, sourceProp);
      const sourceShape = resolveObject(initializer);
      if (sourceShape) objectAliases.set(aliasDeclaration, new Map(sourceShape));
    } else if (Node.isObjectBindingPattern(declarationName)) {
      const sourceShape = resolveObject(initializer);
      if (sourceShape) {
        const hasInvalidatedBinding = declarationName
          .getElements()
          .some((element) => reboundDeclarations.has(getDeclarationIdentity(element.getNameNode())));
        if (!hasInvalidatedBinding) addBindings(declarationName, sourceShape);
      }
    }
  }

  const intrinsicDomProps = new Set<string>();
  const componentEdges: PropForwardingEdge[] = [];
  const recordForwarding = (tagNameNode: Node, targetProp: string, sourceProp: string): void => {
    const tagName = tagNameNode.getText();
    if (isIntrinsicJsxElement(tagName)) {
      if (targetProp === sourceProp) intrinsicDomProps.add(sourceProp);
      return;
    }
    const targetComponentIdentity = resolveForwardedComponentIdentity(tagNameNode);
    if (targetComponentIdentity) componentEdges.push({ sourceProp, targetComponentIdentity, targetProp });
  };

  for (const attribute of func.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (!belongsToComponentFunction(attribute)) continue;
    const tagNameNode = getJsxTagNameNode(attribute);
    if (!tagNameNode) continue;
    const initializer = attribute.getInitializer();
    if (!initializer || !Node.isJsxExpression(initializer)) continue;
    const sourceProp = resolveValue(initializer.getExpression());
    if (sourceProp) recordForwarding(tagNameNode, attribute.getNameNode().getText(), sourceProp);
  }

  for (const spread of func.getDescendantsOfKind(SyntaxKind.JsxSpreadAttribute)) {
    if (!belongsToComponentFunction(spread)) continue;
    const tagNameNode = getJsxTagNameNode(spread);
    if (!tagNameNode) continue;
    const shape = resolveObject(spread.getExpression());
    for (const [targetProp, sourceProp] of shape ?? []) recordForwarding(tagNameNode, targetProp, sourceProp);
  }

  return { intrinsicDomProps, componentEdges };
}

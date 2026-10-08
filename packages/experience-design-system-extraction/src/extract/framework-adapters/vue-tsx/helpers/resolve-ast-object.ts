import { Node, SyntaxKind } from 'ts-morph';
import { getValueTargetDeclarations } from '../../shared/helpers/tsx-shared.js';

/** Recursively resolves a node to the object literal it represents or returns, or undefined. */
export function resolveReturnedObjectLiteral(
  node: Node,
  seen: Set<Node>,
): import('ts-morph').ObjectLiteralExpression | undefined {
  if (seen.has(node)) return undefined;
  seen.add(node);

  if (Node.isObjectLiteralExpression(node)) return node;

  if (Node.isParenthesizedExpression(node)) {
    return resolveReturnedObjectLiteral(node.getExpression(), seen);
  }

  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    if (!initializer) return undefined;
    return resolveReturnedObjectLiteral(initializer, seen);
  }

  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    if (Node.isObjectLiteralExpression(body)) return body;
    const block = body.asKind(SyntaxKind.Block);
    if (block) return resolveObjectLiteralFromStatements(block.getStatements(), seen);
    return resolveReturnedObjectLiteral(body, seen);
  }

  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node)) {
    const body = node.getBody();
    if (!body) return undefined;
    const block = body.asKind(SyntaxKind.Block);
    if (!block) return undefined;
    return resolveObjectLiteralFromStatements(block.getStatements(), seen);
  }

  if (Node.isCallExpression(node)) {
    return resolveObjectLiteralFromCallExpression(node, seen);
  }

  if (Node.isIdentifier(node)) {
    for (const declaration of getValueTargetDeclarations(node)) {
      const resolved = resolveReturnedObjectLiteral(declaration, seen);
      if (resolved) return resolved;
    }
  }

  return undefined;
}

/** Scans a list of statements for a `return <object literal>` and resolves it. */
export function resolveObjectLiteralFromStatements(
  statements: import('ts-morph').Statement[],
  seen: Set<Node>,
): import('ts-morph').ObjectLiteralExpression | undefined {
  for (const statement of statements) {
    if (!Node.isReturnStatement(statement)) continue;
    const expression = statement.getExpression();
    if (!expression) continue;
    const resolved = resolveReturnedObjectLiteral(expression, seen);
    if (resolved) return resolved;
  }
  return undefined;
}

/** Resolves a call expression's callee to an object literal it returns. */
export function resolveObjectLiteralFromCallExpression(
  callExpression: import('ts-morph').CallExpression,
  seen: Set<Node>,
): import('ts-morph').ObjectLiteralExpression | undefined {
  const expression = callExpression.getExpression();
  if (!Node.isIdentifier(expression)) return undefined;
  for (const declaration of getValueTargetDeclarations(expression)) {
    const resolved = resolveReturnedObjectLiteral(declaration, seen);
    if (resolved) return resolved;
  }
  return undefined;
}

/** Returns the trailing identifier name from an expression (e.g. `foo.bar` → `'bar'`). */
export function getExpressionTerminalName(node: Node): string | undefined {
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  return undefined;
}

/** Extracts an array of string literal values, or returns undefined if any element is not a string literal. */
export function extractStringArrayLiteralValues(node: Node): string[] | undefined {
  if (!Node.isArrayLiteralExpression(node)) return undefined;
  const keys: string[] = [];
  for (const element of node.getElements()) {
    if (!Node.isStringLiteral(element) && !Node.isNoSubstitutionTemplateLiteral(element)) {
      return undefined;
    }
    keys.push(element.getLiteralText());
  }
  return keys;
}

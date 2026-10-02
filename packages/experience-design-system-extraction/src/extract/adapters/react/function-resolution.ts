import {
  Node,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type VariableDeclaration,
} from 'ts-morph';
import { getNodeDefinitions } from '../support/tsx-shared.js';

export type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

export function resolveFunctionNode(decl: Node): FunctionLike | undefined {
  if (Node.isFunctionDeclaration(decl)) return decl;
  if (Node.isArrowFunction(decl)) return decl;
  if (Node.isFunctionExpression(decl)) return decl;

  if (Node.isVariableDeclaration(decl)) {
    const init = (decl as VariableDeclaration).getInitializer();
    if (init && Node.isArrowFunction(init)) return init;
    if (init && Node.isFunctionExpression(init)) return init;
    if (init && Node.isCallExpression(init)) return resolveFunctionFromCallExpression(init, new Set<Node>());
  }

  return undefined;
}

export function resolveBestFunctionNode(declarations: Node[]): FunctionLike | undefined {
  const candidates = declarations
    .map((decl) => resolveFunctionNode(decl))
    .filter((candidate): candidate is FunctionLike => candidate !== undefined);

  const implementation = candidates.find(
    (candidate) => !Node.isFunctionDeclaration(candidate) || candidate.getBody() !== undefined,
  );

  return implementation ?? candidates[0];
}

function resolveForwardRefFunction(callExpr: Node): FunctionLike | undefined {
  if (!Node.isCallExpression(callExpr)) return undefined;

  const expressionText = callExpr.getExpression().getText();
  if (!/(^|\.)forwardRef$/.test(expressionText)) return undefined;

  const firstArg = callExpr.getArguments()[0];
  if (!firstArg) return undefined;

  if (Node.isArrowFunction(firstArg)) return firstArg;
  if (Node.isFunctionExpression(firstArg)) return firstArg;

  if (Node.isIdentifier(firstArg)) {
    const declarations = getNodeDefinitions(firstArg).flatMap((definition) => {
      const declarationNode = definition.getDeclarationNode();
      return declarationNode ? [declarationNode] : [];
    });

    for (const declaration of declarations) {
      const resolved = resolveFunctionNode(declaration);
      if (resolved) return resolved;
    }
  }

  return undefined;
}

function resolveFunctionFromCallExpression(
  callExpr: import('ts-morph').CallExpression,
  seen: Set<Node>,
): FunctionLike | undefined {
  return resolveForwardRefFunction(callExpr) ?? resolveReturnedFunctionFromFactoryCall(callExpr, seen);
}

function resolveReturnedFunctionFromFactoryCall(
  callExpr: import('ts-morph').CallExpression,
  seen: Set<Node>,
): FunctionLike | undefined {
  const expression = callExpr.getExpression();
  if (!Node.isIdentifier(expression)) return undefined;

  for (const definition of getNodeDefinitions(expression)) {
    const declaration = definition.getDeclarationNode();
    if (!declaration) continue;

    const resolved = resolveReturnedFunctionFromDeclaration(declaration, seen);
    if (resolved) return resolved;
  }

  return undefined;
}

function resolveReturnedFunctionFromDeclaration(node: Node, seen: Set<Node>): FunctionLike | undefined {
  if (seen.has(node)) return undefined;
  seen.add(node);

  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    if (!initializer) return undefined;

    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
      return resolveReturnedFunctionFromCallable(initializer, seen);
    }

    if (Node.isCallExpression(initializer)) {
      return resolveFunctionFromCallExpression(initializer, seen);
    }

    return undefined;
  }

  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node)) {
    return resolveReturnedFunctionFromCallable(node, seen);
  }

  return undefined;
}

function resolveReturnedFunctionFromCallable(
  fn: FunctionDeclaration | FunctionExpression | ArrowFunction,
  seen: Set<Node>,
): FunctionLike | undefined {
  const body = fn.getBody();
  if (!body) return undefined;

  if (!Node.isBlock(body)) {
    return resolveReturnedFunctionFromExpression(body, seen);
  }

  for (const statement of body.getStatements()) {
    if (!Node.isReturnStatement(statement)) continue;
    const expression = statement.getExpression();
    if (!expression) continue;

    const resolved = resolveReturnedFunctionFromExpression(expression, seen);
    if (resolved) return resolved;
  }

  return undefined;
}

function resolveReturnedFunctionFromExpression(node: Node, seen: Set<Node>): FunctionLike | undefined {
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) return node;

  if (Node.isParenthesizedExpression(node)) {
    return resolveReturnedFunctionFromExpression(node.getExpression(), seen);
  }

  if (Node.isCallExpression(node)) {
    return resolveFunctionFromCallExpression(node, seen);
  }

  if (Node.isIdentifier(node)) {
    for (const definition of getNodeDefinitions(node)) {
      const declaration = definition.getDeclarationNode();
      if (!declaration) continue;

      const resolved = resolveReturnedFunctionFromDeclaration(declaration, seen);
      if (resolved) return resolved;
    }
  }

  return undefined;
}

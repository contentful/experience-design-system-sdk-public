import {
  Node,
  SyntaxKind,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';
import { extractAllowedComponentsFromTypeText, type AllowedComponentsContext } from './collect-allowed-component-names.js';
import { collectLocallyBoundNames } from './ast/get-jsx-ast-data.js';

export { collectRenderedComponentReferences, collectArrayMapRenderComponentReferences } from './ast/collect-structural-jsx-evidence.js';

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

export function collectTypePredicateComponentReferences(
  sourceFile: SourceFile,
  ctx: AllowedComponentsContext,
): string[] {
  const found = new Set<string>();
  const candidates: FunctionLike[] = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
  ];
  for (const fn of candidates) {
    const returnTypeNode = fn.getReturnTypeNode();
    if (!returnTypeNode || !Node.isTypePredicate(returnTypeNode)) continue;
    const assertedTypeNode = returnTypeNode.getTypeNode();
    if (!assertedTypeNode) continue;
    for (const name of extractAllowedComponentsFromTypeText(assertedTypeNode.getText(), ctx)) {
      found.add(name);
    }
  }
  return [...found].sort();
}

export function collectRuntimeTypeCheckComponentReferences(
  sourceFile: SourceFile,
  componentNames: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  const localBindings = collectLocallyBoundNames(sourceFile);

  for (const binary of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = binary.getOperatorToken().getText();
    if (operator !== '===' && operator !== '==') continue;

    const left = binary.getLeft();
    const right = binary.getRight();

    const candidateFromTypeAccess = (typeAccessSide: Node, otherSide: Node): string | undefined => {
      if (!Node.isPropertyAccessExpression(typeAccessSide) || typeAccessSide.getName() !== 'type') return undefined;
      if (!Node.isIdentifier(otherSide) && !Node.isPropertyAccessExpression(otherSide)) return undefined;
      const name = otherSide.getText().split('.').pop();
      if (!name || !componentNames.has(name)) return undefined;
      const baseIdentifier = Node.isPropertyAccessExpression(otherSide) ? otherSide.getExpression() : otherSide;
      if (!Node.isIdentifier(baseIdentifier) || !localBindings.has(baseIdentifier.getText())) return undefined;
      return name;
    };

    const match = candidateFromTypeAccess(left, right) ?? candidateFromTypeAccess(right, left);
    if (match) found.add(match);
  }
  return [...found].sort();
}

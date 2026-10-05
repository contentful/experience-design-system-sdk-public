import {
  Node,
  type ArrowFunction,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';

/** Collects all names bound in the file via imports or top-level declarations. */
export function collectLocallyBoundNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const imp of sourceFile.getImportDeclarations()) {
    const defaultImport = imp.getDefaultImport();
    if (defaultImport) names.add(defaultImport.getText());
    const namespaceImport = imp.getNamespaceImport();
    if (namespaceImport) names.add(namespaceImport.getText());
    for (const named of imp.getNamedImports()) {
      names.add((named.getAliasNode() ?? named.getNameNode()).getText());
    }
  }
  for (const decl of sourceFile.getVariableDeclarations()) names.add(decl.getName());
  for (const decl of sourceFile.getFunctions()) {
    const declName = decl.getName();
    if (declName) names.add(declName);
  }
  return names;
}

/**
 * Returns the tag identifier of the JSX element a callback returns, or
 * `undefined` if the callback doesn't return exactly one identifier-tagged JSX element.
 */
export function getReturnedJsxTagName(callback: ArrowFunction | FunctionExpression): string | undefined {
  const body = callback.getBody();
  const jsxNode = unwrapReturnedJsx(body);
  if (!jsxNode) return undefined;

  if (Node.isJsxSelfClosingElement(jsxNode) || Node.isJsxOpeningElement(jsxNode)) {
    return jsxNode.getTagNameNode().getText();
  }
  if (Node.isJsxElement(jsxNode)) {
    return jsxNode.getOpeningElement().getTagNameNode().getText();
  }
  return undefined;
}

/** Unwraps a JSX node from an expression body, block body return, or parenthesized expression. */
export function unwrapReturnedJsx(bodyOrExpr: Node): Node | undefined {
  if (
    Node.isJsxElement(bodyOrExpr) ||
    Node.isJsxSelfClosingElement(bodyOrExpr) ||
    Node.isJsxOpeningElement(bodyOrExpr)
  ) {
    return bodyOrExpr;
  }
  if (Node.isJsxFragment(bodyOrExpr)) {
    return unwrapSingleJsxChildOfFragment(bodyOrExpr);
  }
  if (Node.isParenthesizedExpression(bodyOrExpr)) {
    return unwrapReturnedJsx(bodyOrExpr.getExpression());
  }
  if (Node.isBlock(bodyOrExpr)) {
    const returns = bodyOrExpr.getStatements().filter(Node.isReturnStatement);
    if (returns.length !== 1) return undefined;
    const expr = returns[0].getExpression();
    if (!expr) return undefined;
    return unwrapReturnedJsx(expr);
  }
  return undefined;
}

/** Returns the single JSX child of a fragment, or undefined if the fragment has 0 or 2+ children. */
export function unwrapSingleJsxChildOfFragment(fragment: Node): Node | undefined {
  if (!Node.isJsxFragment(fragment)) return undefined;
  const jsxChildren = fragment
    .getJsxChildren()
    .filter((child) => Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child));
  if (jsxChildren.length !== 1) return undefined;
  return jsxChildren[0];
}

const JSX_CARRYING_TYPE_TOKENS = ['ReactNode', 'ReactElement', 'JSX.Element'];

/** Returns true when the type text refers to a React JSX-carrying type (ReactNode, ReactElement, JSX.Element). */
export function isJsxCarryingTypeText(typeText: string): boolean {
  for (const token of JSX_CARRYING_TYPE_TOKENS) {
    if (typeText.includes(token)) return true;
  }
  return false;
}

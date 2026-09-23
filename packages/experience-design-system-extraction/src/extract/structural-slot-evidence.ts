import {
  Node,
  SyntaxKind,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';
import { extractAllowedComponentsFromTypeText, type AllowedComponentsContext } from './slot-allowed-components.js';
import { isIntrinsicJsxElement } from './tsx-shared.js';

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

/**
 * Structural composition evidence: parent→child relationships a component's
 * source implies through *usage*, not through a declared slot contract
 * (`ReactElement<XProps>` on the slot's own prop type, `@allowedComponents`,
 * a mapping-layer keyword). Declared contracts still win on conflict — see
 * the `structural` provenance rank in the CLI's composition merge — this is
 * a lower-trust supplementary signal for the common case where a component
 * accepts `children: ReactNode` and narrows it at runtime instead.
 */

/**
 * Signal A — a type-predicate function anywhere in the file asserts a value
 * `is ReactElement<XProps>` (e.g. `function isFooElement(c): c is
 * ReactElement<FooProps>`). Common alongside a runtime `Children.map` /
 * `cloneElement` narrowing pattern where the slot's own prop type is a bare
 * `ReactNode` and carries no generic for the typed-slot extractor to read.
 */
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

/**
 * Signal B — a runtime identity check against a known component, e.g.
 * `isValidElement(child) && child.type === BlueAccordionItem`. `.type` on a
 * React element is the actual component reference, so this is direct
 * evidence the checked value is expected to BE that component — not a name
 * guess, an identity comparison against the real imported binding.
 */
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

/** Names bound in this file by import or local declaration — used to keep signal B from matching an unrelated same-named identifier that was never actually imported here. */
function collectLocallyBoundNames(sourceFile: SourceFile): Set<string> {
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
 * Signal C — a component's own render body literally instantiates another
 * known local component as JSX (e.g. `<CardHeader/>` inside `Card`'s
 * return). Direct structural nesting, not a slot being filled with
 * caller-supplied content — the weakest-trust signal, kept last in the rank.
 */
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

/**
 * Signal D — data-array render: the component's render body maps an array-
 * typed prop to a known child component (e.g. `{items.map(x => <ItemRow
 * .../>)}` inside a parent whose `items` prop is a plain data array).
 *
 * Fires only when ALL strict-gating conditions hold, to keep false positives
 * off in the common case where mapping over data doesn't imply an authorable
 * compositional slot. Conditions are listed in check order (cheap fails
 * first) so the loop-body labels line up 1-to-1 with this list:
 *
 *   1. The `.map` callee is an identifier that matches a declared prop on
 *      the parent (`propNames`).
 *   2. The prop's declared type text is a plain data array — not
 *      `ReactNode[]` / `ReactElement<...>[]` / `React.ReactNode[]`, etc.
 *      (those cases are already covered by the typed-slot pass, so firing
 *      this signal for them would double-count.)
 *   3. The callback returns a JSX element whose tag is an identifier
 *      resolving to a known component (`componentNames`).
 *   4. That child component is NOT rendered anywhere else in the parent's
 *      body — the map is the only render site.
 *
 * When all four hold, the mapped child is a strong candidate for a
 * synthesised default slot on the parent — the extractor treats it that way
 * only when there's no other slot to hang the evidence on (see the caller in
 * react.ts).
 */
export function collectArrayMapRenderComponentReferences(
  funcNode: FunctionLike,
  componentNames: ReadonlySet<string>,
  ownComponentName: string,
  propTypesByName: ReadonlyMap<string, string>,
): string[] {
  const found = new Set<string>();
  const propNames = new Set(propTypesByName.keys());

  const renderCountByComponent = new Map<string, number>();
  const bumpRenderCount = (name: string): void => {
    renderCountByComponent.set(name, (renderCountByComponent.get(name) ?? 0) + 1);
  };
  for (const jsxElement of [
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
  ]) {
    const tagName = jsxElement.getTagNameNode().getText();
    if (isIntrinsicJsxElement(tagName)) continue;
    if (tagName === ownComponentName) continue;
    if (!componentNames.has(tagName)) continue;
    bumpRenderCount(tagName);
  }

  for (const callExpr of funcNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = callExpr.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getName() !== 'map') continue;

    // Condition 1: callee's receiver must be a bare prop identifier.
    const receiver = callee.getExpression();
    if (!Node.isIdentifier(receiver)) continue;
    const propName = receiver.getText();
    if (!propNames.has(propName)) continue;

    // Condition 2: prop's declared type must be a plain data array — reject
    // ReactNode / ReactElement / JSX.Element unions so we don't overlap with
    // the typed-slot pass.
    const propTypeText = propTypesByName.get(propName) ?? '';
    if (isJsxCarryingTypeText(propTypeText)) continue;

    // Condition 3: callback must be a function expression whose return is a
    // JSX element resolving to a known component.
    const [callbackArg] = callExpr.getArguments();
    if (!callbackArg) continue;
    if (!Node.isArrowFunction(callbackArg) && !Node.isFunctionExpression(callbackArg)) continue;

    const returnedJsxTag = getReturnedJsxTagName(callbackArg);
    if (!returnedJsxTag) continue;
    if (returnedJsxTag === ownComponentName) continue;
    if (!componentNames.has(returnedJsxTag)) continue;

    // Condition 4: the child must ONLY be rendered inside this map. Any
    // additional render site elsewhere in the parent means it's a private
    // implementation detail, not a composable slot child.
    const totalRenders = renderCountByComponent.get(returnedJsxTag) ?? 0;
    if (totalRenders !== 1) continue;

    found.add(returnedJsxTag);
  }

  return [...found].sort();
}

/**
 * Returns the tag identifier of the JSX element the callback returns, or
 * `undefined` if the callback doesn't return exactly one identifier-tagged
 * JSX element. Accepts both arrow-with-expression bodies and function bodies
 * with a single return statement. Fragment wrappers with a single JSX child
 * are unwrapped.
 */
function getReturnedJsxTagName(callback: ArrowFunction | FunctionExpression): string | undefined {
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

function unwrapReturnedJsx(bodyOrExpr: Node): Node | undefined {
  // Arrow with expression body: `(x) => <Foo/>` or `(x) => <><Foo/></>`
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

  // Block body: look for a single `return <Foo/>;` at the top level.
  if (Node.isBlock(bodyOrExpr)) {
    const returns = bodyOrExpr.getStatements().filter(Node.isReturnStatement);
    if (returns.length !== 1) return undefined;
    const expr = returns[0].getExpression();
    if (!expr) return undefined;
    return unwrapReturnedJsx(expr);
  }

  return undefined;
}

function unwrapSingleJsxChildOfFragment(fragment: Node): Node | undefined {
  if (!Node.isJsxFragment(fragment)) return undefined;
  const jsxChildren = fragment
    .getJsxChildren()
    .filter((child) => Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child));
  if (jsxChildren.length !== 1) return undefined;
  return jsxChildren[0];
}

const JSX_CARRYING_TYPE_TOKENS = ['ReactNode', 'ReactElement', 'JSX.Element'];

/**
 * True if the type text refers to a React-JSX-carrying type. Used to reject
 * `items: ReactNode[]`-style props from the array-map signal so we don't
 * overlap with the typed-slot pass, which already handles those.
 */
function isJsxCarryingTypeText(typeText: string): boolean {
  for (const token of JSX_CARRYING_TYPE_TOKENS) {
    if (typeText.includes(token)) return true;
  }
  return false;
}

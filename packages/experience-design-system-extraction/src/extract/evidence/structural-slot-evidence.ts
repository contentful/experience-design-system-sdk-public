import {
  Node,
  SyntaxKind,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';
import { extractAllowedComponentsFromTypeText, type AllowedComponentsContext } from './allowed-components.js';
import { isIntrinsicJsxElement } from '../adapters/support/tsx-shared.js';
import {
  collectLocallyBoundNames,
  getReturnedJsxTagName,
  isJsxCarryingTypeText,
} from './helpers/jsx-ast-helpers.js';

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
 * `is ReactElement<XProps>`. Common alongside a runtime `Children.map` /
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
 * evidence the checked value is expected to BE that component.
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

/**
 * Signal C — a component's own render body literally instantiates another
 * known local component as JSX. Direct structural nesting, not a slot being
 * filled with caller-supplied content — the weakest-trust signal.
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
 * typed prop to a known child component. Fires only when ALL strict-gating
 * conditions hold to keep false positives off in the common case where
 * mapping over data doesn't imply an authorable compositional slot.
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

    // Condition 3: callback must return a JSX element resolving to a known component.
    const [callbackArg] = callExpr.getArguments();
    if (!callbackArg) continue;
    if (!Node.isArrowFunction(callbackArg) && !Node.isFunctionExpression(callbackArg)) continue;

    const returnedJsxTag = getReturnedJsxTagName(callbackArg);
    if (!returnedJsxTag) continue;
    if (returnedJsxTag === ownComponentName) continue;
    if (!componentNames.has(returnedJsxTag)) continue;

    // Condition 4: the child must ONLY be rendered inside this map.
    const totalRenders = renderCountByComponent.get(returnedJsxTag) ?? 0;
    if (totalRenders !== 1) continue;

    found.add(returnedJsxTag);
  }

  return [...found].sort();
}

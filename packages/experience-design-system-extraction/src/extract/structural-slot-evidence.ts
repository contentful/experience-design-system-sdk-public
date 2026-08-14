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

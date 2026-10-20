import { Node, SyntaxKind, VariableDeclarationKind, type JsxElement, type JsxSelfClosingElement } from 'ts-morph';
import { createHash } from 'node:crypto';

export interface SourceCallerInput {
  kind: 'property' | 'children' | 'spread';
  name?: string;
  state: 'supplied' | 'text' | 'empty' | 'omitted' | 'unknown';
  representation?: 'literal' | 'jsx' | 'callback' | 'expression';
  value?: string | number | boolean | null;
  expression?: string;
  reason?: string;
  parts?: SourceCallerInput[];
  valueSource?: { sourcePath: string; startLine: number; endLine: number; sourceTextHash: string };
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

type Value = Pick<SourceCallerInput, 'state' | 'representation' | 'value' | 'expression' | 'reason' | 'valueSource'>;

export function callerLocation(
  node: Node,
): Pick<SourceCallerInput, 'startLine' | 'endLine' | 'startOffset' | 'endOffset'> {
  return {
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
    startOffset: node.getStart(),
    endOffset: node.getEnd(),
  };
}

function readValue(node: Node, seen = new Set<Node>()): Value {
  const unknown: Value = {
    state: 'unknown',
    representation: 'expression',
    expression: node.getText(),
    reason: 'Value is not established by supported syntax or constant bindings.',
  };
  if (seen.has(node) || seen.size >= 16) return unknown;
  seen.add(node);
  const literal = (value: Value): Value => ({
    ...value,
    valueSource: {
      sourcePath: node.getSourceFile().getFilePath(),
      startLine: node.getStartLineNumber(),
      endLine: node.getEndLineNumber(),
      sourceTextHash: createHash('sha256').update(node.getSourceFile().getFullText()).digest('hex'),
    },
  });
  if (Node.isParenthesizedExpression(node)) return readValue(node.getExpression(), seen);
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    return literal({ state: 'text', representation: 'literal', value: node.getLiteralText() });
  if (Node.isNumericLiteral(node))
    return literal({ state: 'supplied', representation: 'literal', value: node.getLiteralValue() });
  if (node.getKind() === SyntaxKind.TrueKeyword || node.getKind() === SyntaxKind.FalseKeyword)
    return literal({ state: 'supplied', representation: 'literal', value: node.getKind() === SyntaxKind.TrueKeyword });
  if (node.getKind() === SyntaxKind.NullKeyword)
    return literal({ state: 'empty', representation: 'literal', value: null });
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node))
    return { state: 'supplied', representation: 'callback', expression: node.getText() };
  if (Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node) || Node.isJsxFragment(node))
    return { state: 'supplied', representation: 'jsx', expression: node.getText() };
  if (Node.isPrefixUnaryExpression(node) && Node.isNumericLiteral(node.getOperand())) {
    const operator = node.getOperatorToken();
    const operand = node.getOperand();
    if (Node.isNumericLiteral(operand) && (operator === SyntaxKind.MinusToken || operator === SyntaxKind.PlusToken))
      return literal({
        state: 'supplied',
        representation: 'literal',
        value: operand.getLiteralValue() * (operator === SyntaxKind.MinusToken ? -1 : 1),
      });
  }
  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) {
    const symbol = node.getSymbol();
    const declarations = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
    if (declarations.length === 1) {
      const declaration = declarations[0]!;
      if (
        Node.isVariableDeclaration(declaration) &&
        declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const
      ) {
        const initializer = declaration.getInitializer();
        if (initializer) return readValue(initializer, seen);
      }
      if (Node.isEnumMember(declaration)) {
        const value = declaration.getValue();
        if (typeof value === 'string' || typeof value === 'number')
          return {
            state: typeof value === 'string' ? 'text' : 'supplied',
            representation: 'literal',
            value,
            valueSource: {
              sourcePath: declaration.getSourceFile().getFilePath(),
              startLine: declaration.getStartLineNumber(),
              endLine: declaration.getEndLineNumber(),
              sourceTextHash: createHash('sha256').update(declaration.getSourceFile().getFullText()).digest('hex'),
            },
          };
      }
    }
    if (Node.isIdentifier(node) && node.getText() === 'undefined' && declarations.length === 0)
      return { state: 'empty', representation: 'literal', expression: 'undefined' };
  }
  return unknown;
}

export function readCallerInputs(
  reference: JsxElement | JsxSelfClosingElement,
  declaredNames: readonly string[],
): SourceCallerInput[] {
  const opening = Node.isJsxElement(reference) ? reference.getOpeningElement() : reference;
  const properties = new Map<string, SourceCallerInput>();
  const spreads: SourceCallerInput[] = [];
  let uncertainSpread = false;
  const property = (name: string, node: Node, value: Value) =>
    properties.set(name, { kind: 'property', name, ...value, ...callerLocation(node) });
  const markUnknownSpread = (expression: Node) => {
    uncertainSpread = true;
    spreads.push({
      kind: 'spread',
      state: 'unknown',
      expression: expression.getText(),
      reason: 'Spread keys or values are not fully established.',
      ...callerLocation(expression),
    });
    for (const name of properties.keys())
      properties.set(name, {
        kind: 'property',
        name,
        state: 'unknown',
        expression: expression.getText(),
        reason: 'A later unresolved spread may replace this value.',
        ...callerLocation(expression),
      });
  };
  for (const attribute of opening.getAttributes()) {
    if (Node.isJsxSpreadAttribute(attribute)) {
      const expression = attribute.getExpression();
      if (
        !Node.isObjectLiteralExpression(expression) ||
        expression
          .getProperties()
          .some((p) => !Node.isPropertyAssignment(p) || Node.isComputedPropertyName(p.getNameNode()))
      ) {
        markUnknownSpread(expression);
        continue;
      }
      for (const member of expression.getProperties()) {
        if (Node.isPropertyAssignment(member)) {
          const name = member.getNameNode();
          property(
            Node.isStringLiteral(name) ? name.getLiteralText() : member.getName(),
            member,
            readValue(member.getInitializerOrThrow()),
          );
        }
      }
      continue;
    }
    const initializer = attribute.getInitializer();
    const value = !initializer
      ? { state: 'supplied' as const, representation: 'literal' as const, value: true }
      : Node.isJsxExpression(initializer)
        ? initializer.getExpression()
          ? readValue(initializer.getExpression()!)
          : { state: 'empty' as const }
        : readValue(initializer);
    property(attribute.getNameNode().getText(), attribute, value);
  }
  for (const name of declaredNames)
    if (!properties.has(name))
      property(name, opening, {
        state: uncertainSpread ? 'unknown' : 'omitted',
        ...(uncertainSpread ? { reason: 'An unresolved spread may supply this property.' } : {}),
      });
  const children = Node.isJsxElement(reference)
    ? reference.getJsxChildren().filter((child) => !Node.isJsxText(child) || child.getText().trim())
    : [];
  let value: Value;
  if (!Node.isJsxElement(reference)) value = { state: 'omitted' };
  else if (!children.length) value = { state: 'empty' };
  else if (children.every(Node.isJsxText))
    value = { state: 'text', representation: 'literal', value: children.map((child) => child.getText()).join('') };
  else if (children.length === 1 && children[0] && Node.isJsxExpression(children[0])) {
    const expression = children[0].getExpression();
    value = expression ? readValue(expression) : { state: 'empty' };
  } else
    value = { state: 'supplied', representation: 'jsx', expression: children.map((child) => child.getText()).join('') };
  const parts: SourceCallerInput[] = children.map((child) => {
    const expression = Node.isJsxExpression(child) ? child.getExpression() : child;
    const part: Value = Node.isJsxText(child)
      ? { state: 'text', representation: 'literal', value: child.getText() }
      : expression
        ? readValue(expression)
        : { state: 'empty' };
    return { kind: 'children', ...part, ...callerLocation(child) };
  });
  return [...properties.values(), ...spreads, { kind: 'children', ...value, parts, ...callerLocation(reference) }];
}

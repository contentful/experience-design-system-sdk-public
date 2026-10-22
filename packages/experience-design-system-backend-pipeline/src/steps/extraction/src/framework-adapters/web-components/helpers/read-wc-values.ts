import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Node, SyntaxKind, type TypeNode } from 'ts-morph';
import type {
  SourceDomain,
  SourceDomainLiteral,
  SourceFactLocation,
  SourceSyntaxObservation,
} from '../../../candidates/types.js';

const MAX_RESOLUTION_DEPTH = 64;

export function wcLocation(node: Node): SourceFactLocation {
  const file = node.getSourceFile();
  return {
    fileId: null,
    canonicalPath: resolve(file.getFilePath()),
    textHash: createHash('sha256').update(file.getFullText()).digest('hex'),
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
    binding: 'unverified',
  };
}

export function wcDeclarations(node: Node): Node[] {
  const symbol = node.getSymbol();
  if (!symbol) return [];
  return (symbol.isAlias() ? symbol.getAliasedSymbol() : symbol)?.getDeclarations() ?? [];
}

export function wcKey(node: Node): string | null {
  if (Node.isIdentifier(node) || Node.isPrivateIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node) || Node.isNumericLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    return String(node.getLiteralValue());
  if (Node.isComputedPropertyName(node)) {
    const value = resolveWcValue(node.getExpression());
    return value.value?.kind === 'string' || value.value?.kind === 'number' ? value.value.value : null;
  }
  return null;
}

function primitive(node: Node): SourceDomainLiteral | null {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    return { kind: 'string', value: node.getLiteralValue() };
  if (Node.isNumericLiteral(node)) return { kind: 'number', value: String(node.getLiteralValue()) };
  if (node.getKind() === SyntaxKind.TrueKeyword || node.getKind() === SyntaxKind.FalseKeyword)
    return { kind: 'boolean', value: node.getText() };
  if (node.getKind() === SyntaxKind.NullKeyword) return { kind: 'null', value: 'null' };
  if (Node.isPrefixUnaryExpression(node) && Node.isNumericLiteral(node.getOperand())) {
    const operand = node.getOperand().asKindOrThrow(SyntaxKind.NumericLiteral).getLiteralValue();
    if (node.getOperatorToken() === SyntaxKind.MinusToken) return { kind: 'number', value: String(-operand) };
    if (node.getOperatorToken() === SyntaxKind.PlusToken) return { kind: 'number', value: String(operand) };
  }
  return null;
}

export function resolveWcValue(
  node: Node | undefined,
  seen = new Set<Node>(),
  depth = 0,
): SourceSyntaxObservation['default'] {
  if (!node) return { expression: null, state: 'absent', value: null, reason: null, locations: [] };
  const location = wcLocation(node);
  const unknown = (reason: string): SourceSyntaxObservation['default'] => ({
    expression: node.getText(),
    state: 'unresolved',
    value: null,
    reason,
    locations: [location],
  });
  if (depth >= MAX_RESOLUTION_DEPTH) return unknown('resolution-depth-exhausted');
  if (seen.has(node)) return unknown('cycle');
  const nextSeen = new Set(seen).add(node);
  const literal = primitive(node);
  if (literal)
    return { expression: node.getText(), state: 'literal', value: literal, reason: null, locations: [location] };
  const wrap = (result: SourceSyntaxObservation['default']): SourceSyntaxObservation['default'] => ({
    ...result,
    expression: node.getText(),
    state: result.value ? 'resolved' : 'unresolved',
    locations: [location, ...result.locations],
  });
  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isTypeAssertion(node) ||
    Node.isSatisfiesExpression(node)
  )
    return wrap(resolveWcValue(node.getExpression(), nextSeen, depth + 1));
  if (Node.isIdentifier(node) || Node.isPropertyAccessExpression(node)) {
    for (const declaration of wcDeclarations(node)) {
      if (Node.isEnumMember(declaration)) {
        const value = declaration.getValue();
        if (typeof value === 'number' || typeof value === 'string')
          return {
            expression: node.getText(),
            state: 'resolved',
            value: { kind: typeof value === 'number' ? 'number' : 'string', value: String(value) },
            reason: null,
            locations: [location, wcLocation(declaration)],
          };
      }
      if (
        Node.isIdentifier(node) &&
        Node.isVariableDeclaration(declaration) &&
        declaration.getVariableStatement()?.getDeclarationKind() === 'const'
      )
        return wrap(resolveWcValue(declaration.getInitializer(), nextSeen, depth + 1));
    }
    return unknown(
      Node.isPropertyAccessExpression(node) ? 'non-enum-property-access' : 'unresolved-or-mutable-identifier',
    );
  }
  return unknown('nonliteral-expression-not-executed');
}

export function resolveWcDomain(
  node: TypeNode | undefined,
  fallback: string,
): { domain: SourceDomain; locations: SourceFactLocation[] } {
  if (!node)
    return {
      domain: {
        observedLiterals: [],
        openness: ['string', 'number', 'boolean'].includes(fallback) ? 'open' : 'unknown',
      },
      locations: [],
    };
  const locations: SourceFactLocation[] = [];
  const visit = (current: Node, seen: Set<Node>, depth: number): SourceDomain => {
    locations.push(wcLocation(current));
    if (depth >= MAX_RESOLUTION_DEPTH || seen.has(current)) return { observedLiterals: [], openness: 'unknown' };
    const nextSeen = new Set(seen).add(current);
    if (Node.isParenthesizedTypeNode(current)) return visit(current.getTypeNode(), nextSeen, depth + 1);
    if (Node.isUnionTypeNode(current)) {
      const alternatives = current.getTypeNodes().map((item) => visit(item, nextSeen, depth + 1));
      const openness = alternatives.some((item) => item.openness === 'unknown')
        ? 'unknown'
        : alternatives.some((item) => item.openness === 'open')
          ? 'open'
          : 'closed';
      return { observedLiterals: alternatives.flatMap((item) => item.observedLiterals), openness };
    }
    if (Node.isLiteralTypeNode(current)) {
      const value = primitive(current.getLiteral());
      return { observedLiterals: value ? [value] : [], openness: value ? 'closed' : 'unknown' };
    }
    if (
      [
        SyntaxKind.StringKeyword,
        SyntaxKind.NumberKeyword,
        SyntaxKind.BooleanKeyword,
        SyntaxKind.BigIntKeyword,
      ].includes(current.getKind())
    )
      return { observedLiterals: [], openness: 'open' };
    if ([SyntaxKind.UndefinedKeyword, SyntaxKind.NeverKeyword].includes(current.getKind()))
      return { observedLiterals: [], openness: 'closed' };
    if (Node.isTypeReference(current)) {
      for (const declaration of wcDeclarations(current.getTypeName())) {
        if (Node.isTypeAliasDeclaration(declaration))
          return visit(declaration.getTypeNodeOrThrow(), nextSeen, depth + 1);
        if (Node.isEnumDeclaration(declaration)) {
          locations.push(wcLocation(declaration));
          const observedLiterals: SourceDomainLiteral[] = [];
          let openness: SourceDomain['openness'] = 'closed';
          for (const member of declaration.getMembers()) {
            const value = member.getValue();
            if (typeof value === 'number' || typeof value === 'string')
              observedLiterals.push({ kind: typeof value === 'number' ? 'number' : 'string', value: String(value) });
            else openness = 'unknown';
          }
          return { observedLiterals, openness };
        }
      }
    }
    return { observedLiterals: [], openness: 'unknown' };
  };
  const domain = visit(node, new Set(), 0);
  return {
    domain: {
      ...domain,
      observedLiterals: [...new Map(domain.observedLiterals.map((value) => [JSON.stringify(value), value])).values()],
    },
    locations,
  };
}

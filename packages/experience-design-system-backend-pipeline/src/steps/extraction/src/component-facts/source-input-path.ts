import ts from 'typescript';
import type { SourceAccessSegment, SourceInputAccessPath } from '../types/component-source-observations.js';
import { SourceObservationReader } from './source-observation-reader.js';

/** Opaque paths follow declaration identity, never dotted string splitting. */
export class SourceInputPaths {
  private readonly roots = new Map<ts.Declaration, SourceInputAccessPath>();
  private readonly reassignedRoots = new Set<string>();
  private readonly cached = new Map<ts.Node, SourceInputAccessPath | null>();
  constructor(
    private readonly reader: SourceObservationReader,
    parameters: readonly ts.ParameterDeclaration[],
  ) {
    parameters.forEach((parameter, parameterIndex) =>
      this.roots.set(parameter, {
        rootSymbolId: reader.identity(parameter),
        rootDeclaration: reader.location(parameter),
        parameterIndex,
        segments: [],
        certainty: 'certain',
        reason: null,
      }),
    );
  }
  recordAssignment(target: ts.Node): void {
    if (!ts.isIdentifier(target)) return;
    let declaration = this.reader.checker.getSymbolAtLocation(target)?.valueDeclaration;
    while (declaration && ts.isBindingElement(declaration)) {
      const owner = declaration.parent.parent;
      declaration = ts.isParameter(owner) || ts.isBindingElement(owner) ? owner : undefined;
    }
    const root = declaration ? this.roots.get(declaration) : undefined;
    if (root) {
      this.reassignedRoots.add(root.rootSymbolId);
      this.reader.omit('parameter-reassigned', target);
    }
  }
  qualify(value: SourceInputAccessPath | null): SourceInputAccessPath | null {
    return value && this.reassignedRoots.has(value.rootSymbolId)
      ? { ...value, certainty: 'ambiguous', reason: 'parameter-reassigned' }
      : value;
  }
  private append(
    path: SourceInputAccessPath | null,
    segment: SourceAccessSegment,
    reason: string | null = null,
  ): SourceInputAccessPath | null {
    if (!path) return null;
    return {
      ...path,
      segments: [...path.segments, segment],
      certainty: reason ? 'ambiguous' : path.certainty,
      reason: reason ?? path.reason,
    };
  }
  private key(node: ts.Node): SourceAccessSegment {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node))
      return { kind: 'field', name: ts.isIdentifier(node) ? node.text : node.text };
    if (ts.isNumericLiteral(node)) return { kind: 'index', value: node.text };
    if (ts.isComputedPropertyName(node)) return this.elementKey(node.expression);
    return { kind: 'computed', expression: node.getText() };
  }
  private elementKey(node: ts.Node): SourceAccessSegment {
    if (ts.isStringLiteralLike(node)) return { kind: 'field', name: node.text };
    if (ts.isNumericLiteral(node)) return { kind: 'index', value: node.text };
    return { kind: 'computed', expression: node.getText() };
  }
  declaration(declaration: ts.Declaration, seen = new Set<ts.Node>()): SourceInputAccessPath | null {
    const root = this.roots.get(declaration);
    if (root) return root;
    if (seen.has(declaration)) {
      this.reader.omit('input-alias-cycle', declaration);
      return null;
    }
    seen.add(declaration);
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const value = this.path(declaration.initializer, seen);
      if (value && !(declaration.parent.flags & ts.NodeFlags.Const)) {
        this.reader.omit('mutable-alias', declaration);
        return { ...value, certainty: 'ambiguous', reason: 'mutable-alias' };
      }
      return value;
    }
    if (ts.isBindingElement(declaration)) {
      const pattern = declaration.parent;
      const owner = pattern.parent;
      const base =
        ts.isParameter(owner) || ts.isVariableDeclaration(owner) || ts.isBindingElement(owner)
          ? this.declaration(owner, seen)
          : null;
      if (declaration.dotDotDotToken) {
        if (base) this.reader.omit('rest-path-partial', declaration);
        return this.append(base, { kind: 'rest' }, 'rest-path-partial');
      }
      const segment = ts.isArrayBindingPattern(pattern)
        ? { kind: 'index' as const, value: String(pattern.elements.indexOf(declaration)) }
        : this.key(declaration.propertyName ?? declaration.name);
      if (base && segment.kind === 'computed') this.reader.omit('computed-key-unresolved', declaration);
      return this.append(base, segment, segment.kind === 'computed' ? 'computed-key-unresolved' : null);
    }
    return null;
  }
  path(node: ts.Node, seen = new Set<ts.Node>()): SourceInputAccessPath | null {
    if (this.cached.has(node)) return this.cached.get(node)!;
    if (seen.has(node)) {
      this.reader.omit('input-alias-cycle', node);
      return null;
    }
    if (seen.size > this.reader.collection.limits.maxDepth) {
      this.reader.omit('input-path-depth-limit', node);
      return null;
    }
    if (!this.reader.admit('maxReferences', node)) return null;
    seen.add(node);
    let result: SourceInputAccessPath | null = null;
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      result = this.path(node.expression, seen);
    else if (ts.isPropertyAccessExpression(node))
      result = this.append(this.path(node.expression, seen), { kind: 'field', name: node.name.text });
    else if (ts.isElementAccessExpression(node)) {
      const base = this.path(node.expression, seen);
      const segment = this.elementKey(node.argumentExpression);
      if (base && segment.kind === 'computed') this.reader.omit('computed-key-unresolved', node);
      result = this.append(base, segment, segment.kind === 'computed' ? 'computed-key-unresolved' : null);
    } else if (ts.isIdentifier(node)) {
      const symbol = this.reader.checker.getSymbolAtLocation(node);
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (declaration) result = this.declaration(declaration, seen);
    }
    this.cached.set(node, result);
    return result;
  }
}

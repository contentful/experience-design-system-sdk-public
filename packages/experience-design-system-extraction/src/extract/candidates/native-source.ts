import ts from 'typescript';
import { createHash } from 'node:crypto';
import type { Node, Type } from 'ts-morph';
import type {
  NativeSourceShape,
  SourceDefaultFact,
  SourceFactLocation,
  SourceJsonValue,
  SourceTypeGraph,
  SourceTypeNode,
} from './types.js';

/** Decode closed syntax only; identifiers, calls, spreads and computed keys remain evidence. */
export function decodeSourceDefault(expression: string, location: SourceFactLocation | null): SourceDefaultFact {
  const source = ts.createSourceFile('__default__.ts', `const value = (${expression});`, ts.ScriptTarget.Latest, true);
  const decode = (node: ts.Expression): SourceJsonValue => {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node)
    )
      return decode(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) {
      const n = Number(node.text);
      if (Number.isFinite(n) && (!Number.isInteger(n) || Number.isSafeInteger(n))) return n;
      throw new Error('Unsafe numeric literal');
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (
      ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)
    ) {
      const operand = decode(node.operand);
      if (typeof operand === 'number') return node.operator === ts.SyntaxKind.MinusToken ? -operand : operand;
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => decode(item));
    if (ts.isObjectLiteralExpression(node)) {
      const result: Record<string, SourceJsonValue> = Object.create(null);
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error('Nonliteral object member');
        const computed = ts.isComputedPropertyName(property.name);
        const name = computed ? property.name.expression : property.name;
        if (!(ts.isStringLiteral(name) || ts.isNumericLiteral(name) || (!computed && ts.isIdentifier(name))))
          throw new Error('Nonliteral object member');
        const key = ts.isNumericLiteral(name) ? String(Number(name.text)) : name.text;
        if (!computed && key === '__proto__') throw new Error('Prototype setter is not an own data member');
        if (Object.hasOwn(result, key)) throw new Error('Duplicate literal key');
        result[key] = decode(property.initializer);
      }
      return result;
    }
    throw new Error('Expression is not closed literal syntax');
  };
  try {
    if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length)
      throw new Error('Invalid expression');
    if (source.statements.length !== 1 || !ts.isVariableStatement(source.statements[0]!))
      throw new Error('Expected one expression');
    const initializer = source.statements[0]!.declarationList.declarations[0]!.initializer;
    if (!initializer) throw new Error('Missing expression');
    return { expression, location, state: 'value', value: decode(initializer), reason: null };
  } catch (error) {
    return {
      expression,
      location,
      state: 'unsupported',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function location(node: Node): SourceFactLocation {
  const source = node.getSourceFile();
  return {
    fileId: null,
    canonicalPath: source.getFilePath(),
    textHash: createHash('sha256').update(source.getFullText()).digest('hex'),
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
    startOffset: node.getStart(),
    endOffset: node.getEnd(),
    binding: 'unverified',
  };
}
function domain(type: Type): SourceTypeNode['domain'] {
  const alternatives = type.isUnion() ? type.getUnionTypes() : [type];
  const values: SourceJsonValue[] = [];
  const unrepresentedValues: Array<{ typeText: string; reason: string }> = [];
  let openness: 'closed' | 'open' | 'unknown' = 'closed';
  for (const part of alternatives) {
    if (part.isUndefined() || part.isNever()) continue;
    if (part.isNull()) values.push(null);
    else if (part.isStringLiteral() || part.isNumberLiteral()) {
      const value = part.getLiteralValue() as string | number;
      if (
        typeof value === 'number' &&
        (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      ) {
        unrepresentedValues.push({ typeText: part.getText(), reason: 'unsafe-number' });
        openness = 'unknown';
      } else values.push(value);
    } else if (part.isBooleanLiteral()) values.push(part.getText() === 'true');
    else if (part.isString() || part.isNumber() || part.isBoolean())
      openness = openness === 'unknown' ? 'unknown' : 'open';
    else openness = 'unknown';
  }
  return {
    openness,
    declaredValues: values,
    provenance: unrepresentedValues.length ? 'unknown' : 'compiler',
    ...(unrepresentedValues.length ? { unrepresentedValues } : {}),
  };
}

export function captureNativeSource(
  type: Type,
  fallback: Node,
  required: boolean,
  keyPath: string[],
): { graph: SourceTypeGraph; shape: NativeSourceShape | null; notes: string[]; requiredFieldDropped: boolean | null } {
  const graph: SourceTypeGraph = {
    schemaVersion: 1,
    used: { propertyEnumerations: 0, enumeratedProperties: 0, wrappedProperties: 0 },
    limitations: ['compiler-internal-type-resolution-is-not-preemptible'],
    rootId: '',
    nodes: [],
    coverage: 'complete-within-declared-bound',
    limits: { maxDepth: 16, maxNodes: 512, maxFields: 2048 },
    omittedCount: 0,
  };
  const ancestors = new Map<object, string>();
  let fieldCount = 0;
  let knownRequiredFieldDropped = false;
  const walk = (
    t: Type,
    at: Node,
    req: boolean,
    keys: string[],
    depth: number,
  ): { id: string; shape: NativeSourceShape | null } => {
    const id = `n${graph.nodes.length}`;
    const node: SourceTypeNode = {
      id,
      keyPath: keys,
      kind: 'unknown',
      typeText: t.getText(at),
      required: req,
      declarations: [location(at)],
      domain: domain(t),
      coverage: 'complete-within-declared-bound',
      reason: null,
    };
    graph.nodes.push(node);
    const incomplete = (reason: string) => {
      node.reason = reason;
      node.coverage = 'partial';
      graph.coverage = 'partial';
    };
    if (node.domain.unrepresentedValues?.length) incomplete('unsafe-domain-literal');
    if (ancestors.has(t.compilerType)) {
      node.kind = 'reference';
      node.alternatives = [ancestors.get(t.compilerType)!];
      incomplete('cycle');
      return { id, shape: null };
    }
    if (depth > graph.limits.maxDepth || graph.nodes.length >= graph.limits.maxNodes) {
      incomplete('source-type-budget');
      graph.omittedCount++;
      return { id, shape: null };
    }
    ancestors.set(t.compilerType, id);
    try {
      let shape: NativeSourceShape | null = null;
      if (t.isString() || t.isStringLiteral()) {
        node.kind = 'string';
        shape = { $type: 'string', $required: req };
      } else if (t.isNumber() || t.isNumberLiteral()) {
        node.kind = 'number';
        shape = { $type: 'number', $required: req };
      } else if (t.isBoolean() || t.isBooleanLiteral()) {
        node.kind = 'boolean';
        shape = { $type: 'boolean', $required: req };
      } else if (t.isNull() || t.isUndefined() || t.isNever())
        node.kind = t.isNull() ? 'null' : t.isUndefined() ? 'undefined' : 'never';
      else if (t.isUnion() || t.isIntersection()) {
        node.kind = t.isUnion() ? 'union' : 'intersection';
        const alternatives = t.isUnion() ? t.getUnionTypes() : (t as Type).getIntersectionTypes();
        node.alternatives = [];
        const results = [];
        for (const alternative of alternatives) {
          if (graph.nodes.length >= graph.limits.maxNodes) {
            graph.omittedCount++;
            incomplete('union-budget');
            break;
          }
          const result = walk(alternative, at, req, keys, depth + 1);
          node.alternatives.push(result.id);
          results.push(result);
        }
        if (t.isUnion()) {
          const nonAbsent = results.filter(
            (r) => !['undefined', 'never'].includes(graph.nodes.find((n) => n.id === r.id)!.kind),
          );
          if (
            nonAbsent.length &&
            nonAbsent.every(
              (r) =>
                r.shape &&
                ['string', 'number', 'boolean'].includes(r.shape.$type) &&
                r.shape.$type === nonAbsent[0]!.shape!.$type,
            )
          )
            shape = { ...nonAbsent[0]!.shape!, $required: req };
          else incomplete('union-native-shape-unavailable');
        }
      } else if (t.isTuple()) {
        node.kind = 'tuple';
        node.items = [];
        for (const [i, item] of t.getTupleElements().entries()) {
          if (graph.nodes.length >= graph.limits.maxNodes) {
            graph.omittedCount++;
            incomplete('tuple-budget');
            break;
          }
          node.items.push(walk(item, at, true, [...keys, String(i)], depth + 1).id);
        }
        incomplete('tuple-native-shape-unavailable');
      } else if (t.isArray() || t.isReadonlyArray()) {
        node.kind = 'array';
        const item = t.getArrayElementType();
        if (item) {
          const result = walk(item, at, true, [...keys, '[]'], depth + 1);
          node.items = [result.id];
          if (result.shape) shape = { $type: 'array', $required: req, $items: result.shape };
        } else incomplete('array-item-unavailable');
      } else if (t.isObject() || t.isIntersection()) node.kind = 'record';
      else {
        incomplete('native-kind-unavailable');
      }
      if (node.kind === 'record' || node.kind === 'intersection') {
        node.fields = [];
        const fields: Record<string, NativeSourceShape> = Object.create(null);
        let all = true;
        const rawProperties = t.compilerType.getProperties();
        graph.used!.propertyEnumerations++;
        graph.used!.enumeratedProperties += rawProperties.length;
        const remaining = Math.min(graph.limits.maxFields - fieldCount, graph.limits.maxNodes - graph.nodes.length);
        if (rawProperties.length > remaining) {
          graph.omittedCount += rawProperties.length;
          incomplete('field-enumeration-budget');
          return { id, shape: null };
        }
        const properties = t.getProperties();
        graph.used!.wrappedProperties += properties.length;
        for (const [index, symbol] of properties.entries()) {
          if (++fieldCount > graph.limits.maxFields || graph.nodes.length >= graph.limits.maxNodes) {
            graph.omittedCount += properties.length - index;
            incomplete('field-budget');
            all = false;
            break;
          }
          const declaration = symbol.getDeclarations()[0] ?? at;
          const field = walk(
            symbol.getTypeAtLocation(at),
            declaration,
            !symbol.isOptional(),
            [...keys, symbol.getName()],
            depth + 1,
          );
          node.fields.push({ key: symbol.getName(), nodeId: field.id, required: !symbol.isOptional() });
          if (field.shape) {
            const documentation = ts.displayPartsToString(
              symbol.compilerSymbol.getDocumentationComment(
                at.getSourceFile().getProject().getTypeChecker().compilerObject,
              ),
            );
            const description =
              documentation ||
              symbol
                .getJsDocTags()
                .find((tag) => tag.getName() === 'description')
                ?.getText()
                .map((text) => text.text)
                .join('');
            if (description) field.shape.$description = description;
            fields[symbol.getName()] = field.shape;
          } else {
            all = false;
            if (!symbol.isOptional()) knownRequiredFieldDropped = true;
          }
        }
        node.indexSignatures = [];
        for (const [key, index] of [
          ['string', t.getStringIndexType()],
          ['number', t.getNumberIndexType()],
        ] as const)
          if (index) {
            if (graph.nodes.length < graph.limits.maxNodes)
              node.indexSignatures.push({
                keyType: key,
                valueNodeId: walk(index, at, false, [...keys, `[${key}]`], depth + 1).id,
              });
            incomplete('open-index-signature');
            all = false;
          }
        if (all && node.fields.length) shape = { $type: 'record', $required: req, $fields: fields };
        else if (!node.fields.length)
          incomplete(t.getCallSignatures().length ? 'callable-or-empty-record' : 'empty-record');
      }
      if (shape && node.domain.openness === 'closed' && node.domain.declaredValues.length)
        shape.$values = node.domain.declaredValues;
      return { id, shape };
    } finally {
      ancestors.delete(t.compilerType);
    }
  };
  const result = walk(type, fallback, required, keyPath, 0);
  graph.rootId = result.id;
  return {
    graph,
    shape: result.shape,
    requiredFieldDropped: knownRequiredFieldDropped
      ? true
      : graph.coverage === 'complete-within-declared-bound' && result.shape
        ? false
        : null,
    notes: graph.nodes.flatMap((node) => (node.reason ? [`${node.id}: ${node.reason}`] : [])),
  };
}

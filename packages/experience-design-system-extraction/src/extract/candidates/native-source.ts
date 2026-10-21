import ts from 'typescript';
import { SourceValueBindings } from '../component-facts/source-value-bindings.js';
import { sourceLocation } from './source-location.js';
import { createHash } from 'node:crypto';
import { Node, type Type } from 'ts-morph';
import type {
  NativeSourceShape,
  SourceDefaultFact,
  SourceFactLocation,
  SourceJsonValue,
  SourceTypeGraph,
  SourceTypeNode,
} from './types.js';

/** Decode closed syntax only; identifiers, calls, spreads and computed keys remain evidence. */
export function decodeSourceDefault(
  expression: string,
  location: SourceFactLocation | null,
  initializerNode?: Node,
): SourceDefaultFact {
  const dependencies: SourceFactLocation[] = [];
  const project = initializerNode?.getSourceFile().getProject();
  const checker = project?.getTypeChecker().compilerObject as ts.TypeChecker | undefined;
  const bindings = checker ? new SourceValueBindings(checker) : undefined;
  let scanComplete = true;
  if (bindings && project) {
    let remaining = 100_000;
    for (const file of project.getSourceFiles()) {
      if (file.isDeclarationFile()) continue;
      if (remaining <= 0 || !bindings.scan(file.compilerNode as unknown as ts.SourceFile, remaining, true)) {
        scanComplete = false;
        break;
      }
      remaining = 100_000 - bindings.scanNodes;
    }
  }
  const ancestors = new Set<ts.Node>();
  let decodedNodes = 0;
  const source = ts.createSourceFile('__default__.ts', `const value = (${expression});`, ts.ScriptTarget.Latest, true);
  const decode = (node: ts.Expression): SourceJsonValue => {
    if (++decodedNodes > 2048 || ancestors.size >= 64) throw new Error('Default resolution budget');
    if (ancestors.has(node)) throw new Error('Cyclic default binding');
    if (ts.isIdentifier(node)) {
      const declaration = bindings?.declaration(node);
      if (
        !scanComplete ||
        !declaration ||
        !ts.isVariableDeclaration(declaration) ||
        !declaration.initializer ||
        !(declaration.parent.flags & ts.NodeFlags.Const) ||
        bindings!.mutated(declaration)
      )
        throw new Error('Unresolved or write-invalidated default binding');
      const declarationNode = project
        ?.getSourceFile(declaration.getSourceFile().fileName)
        ?.getDescendantAtPos(declaration.getStart());
      if (declarationNode) dependencies.push(sourceLocation(declarationNode));
      ancestors.add(node);
      ancestors.add(declaration);
      try {
        return decode(declaration.initializer);
      } finally {
        ancestors.delete(node);
        ancestors.delete(declaration);
      }
    }
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
        const decodedKey = computed
          ? decode(name as ts.Expression)
          : ts.isIdentifier(name) || ts.isStringLiteral(name)
            ? name.text
            : ts.isNumericLiteral(name)
              ? Number(name.text)
              : undefined;
        if (typeof decodedKey !== 'string' && typeof decodedKey !== 'number') throw new Error('Unresolved object key');
        const key = String(decodedKey);
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
    return {
      expression,
      location,
      ...(initializerNode ? { dependencies } : {}),
      state: 'value',
      value: decode(initializerNode ? (initializerNode.compilerNode as unknown as ts.Expression) : initializer),
      reason: null,
    };
  } catch (error) {
    return {
      expression,
      location,
      ...(initializerNode ? { dependencies } : {}),
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

function declarationType(node: Node): Node | null {
  return Node.isTypeAliasDeclaration(node) ||
    Node.isPropertySignature(node) ||
    Node.isPropertyDeclaration(node) ||
    Node.isParameterDeclaration(node)
    ? (node.getTypeNode() ?? null)
    : null;
}

function sourceNullability(
  type: Type,
  at: Node,
  syntax: Node | null,
): {
  facts: NonNullable<SourceTypeNode['nullability']>;
  syntaxDeclarations: Node[];
} {
  const options = at.getSourceFile().getProject().getCompilerOptions();
  const compilerMode = (options.strictNullChecks ?? options.strict) === true ? 'enabled' : 'disabled';
  const parts = type.isUnion() ? type.getUnionTypes() : [type];
  const unknown = parts.some(
    (part) =>
      part.isAny() ||
      part.isUnknown() ||
      part.isTypeParameter() ||
      Boolean(part.getFlags() & (ts.TypeFlags.Conditional | ts.TypeFlags.IndexedAccess | ts.TypeFlags.Substitution)),
  );
  const positive = { null: false, undefined: false };
  const visited = new Set<Node>();
  const syntaxDeclarations: Node[] = [];
  const pending = syntax ? [syntax] : [];
  while (pending.length && visited.size < 512) {
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (Node.isUnionTypeNode(node)) pending.push(...node.getTypeNodes());
    else if (Node.isParenthesizedTypeNode(node)) pending.push(node.getTypeNode());
    else if (node.getKind() === ts.SyntaxKind.UndefinedKeyword) positive.undefined = true;
    else if (Node.isLiteralTypeNode(node) && node.getLiteral().getKind() === ts.SyntaxKind.NullKeyword)
      positive.null = true;
    else if (Node.isTypeReference(node)) {
      const symbol = node.getTypeName().getSymbol();
      const resolved = symbol?.getAliasedSymbol() ?? symbol;
      for (const declaration of resolved?.getDeclarations() ?? [])
        if (Node.isTypeAliasDeclaration(declaration)) {
          const alias = declaration.getTypeNode();
          if (alias) {
            syntaxDeclarations.push(declaration);
            pending.push(alias);
          }
        }
    }
  }
  const fact = (kind: 'null' | 'undefined'): NonNullable<SourceTypeNode['nullability']>['null'] => {
    if (parts.some((part) => (kind === 'null' ? part.isNull() : part.isUndefined())))
      return { state: 'present', source: 'compiler' };
    if (positive[kind]) return { state: 'present', source: 'syntax' };
    if (unknown) return { state: 'unknown', source: 'unknown' };
    if (compilerMode === 'enabled') return { state: 'absent', source: 'compiler' };
    return { state: 'unknown', source: 'compiler-erased' };
  };
  return { facts: { compilerMode, null: fact('null'), undefined: fact('undefined') }, syntaxDeclarations };
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
    path: NonNullable<SourceTypeNode['path']> = keys.map((key) => ({ kind: 'field', key })),
    syntax: Node | null = declarationType(at),
  ): { id: string; shape: NativeSourceShape | null } => {
    const id = `s${createHash('sha256')
      .update(JSON.stringify([path, t.getText(at), location(at)]))
      .digest('hex')
      .slice(0, 24)}`;
    const { facts: nullability, syntaxDeclarations } = sourceNullability(t, at, syntax);
    const syntaxUsed = nullability.null.source === 'syntax' || nullability.undefined.source === 'syntax';
    const node: SourceTypeNode = {
      id,
      keyPath: keys,
      path,
      ...(t.getAliasSymbol() ? { alias: t.getAliasSymbol()!.getName() } : {}),
      ...(nullability.null.state === 'unknown' ? {} : { nullable: nullability.null.state === 'present' }),
      ...(nullability.undefined.state === 'unknown' ? {} : { undefinable: nullability.undefined.state === 'present' }),
      nullability,
      nullabilityProvenance:
        nullability.null.source === nullability.undefined.source ? nullability.null.source : 'unknown',
      kind: 'unknown',
      typeText: t.getText(at),
      required: req,
      declarations: [...new Set([at, ...(syntaxUsed ? syntaxDeclarations : [])])].map(location),
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
      node.reason = 'cycle-reference';
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
        for (const [index, alternative] of alternatives.entries()) {
          if (graph.nodes.length >= graph.limits.maxNodes) {
            graph.omittedCount++;
            incomplete('union-budget');
            break;
          }
          const result = walk(
            alternative,
            at,
            req,
            keys,
            depth + 1,
            [...path, { kind: t.isUnion() ? 'union' : 'intersection', key: index }],
            null,
          );
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
          else node.reason = 'union-native-shape-unavailable';
          const members = results.map((result) => graph.nodes.find((n) => n.id === result.id)!);
          node.discriminatorKeys = (members[0]?.fields ?? [])
            .filter((field) => {
              const values: SourceJsonValue[] = [];
              return (
                members.length === alternatives.length &&
                members.every((member) => {
                  const edge = member.fields?.find((other) => other.key === field.key);
                  const tag = edge && graph.nodes.find((item) => item.id === edge.nodeId);
                  if (
                    !edge?.required ||
                    !tag ||
                    tag.coverage !== 'complete-within-declared-bound' ||
                    tag.domain.provenance !== 'compiler' ||
                    tag.domain.openness !== 'closed' ||
                    tag.domain.declaredValues.length !== 1 ||
                    values.some((value) => value === tag.domain.declaredValues[0])
                  )
                    return false;
                  values.push(tag.domain.declaredValues[0]!);
                  return true;
                })
              );
            })
            .map((field) => field.key);
          node.discriminator = {
            provenance: 'compiler',
            complete: members.length === alternatives.length,
            keys: node.discriminatorKeys,
          };
        }
      } else if (t.isTuple()) {
        node.kind = 'tuple';
        node.items = [];
        node.tupleElements = [];
        const target = (t.compilerType as unknown as ts.TupleTypeReference).target;
        node.readonly = target.readonly;
        for (const [i, item] of t.getTupleElements().entries()) {
          if (graph.nodes.length >= graph.limits.maxNodes) {
            graph.omittedCount++;
            incomplete('tuple-budget');
            break;
          }
          const flags = target.elementFlags[i] ?? ts.ElementFlags.Required;
          const label = target.labeledElementDeclarations?.[i];
          const element = walk(
            item,
            at,
            !(flags & ts.ElementFlags.Optional),
            [...keys, String(i)],
            depth + 1,
            [...path, { kind: 'tuple', key: i }],
            null,
          );
          node.items.push(element.id);
          node.tupleElements.push({
            nodeId: element.id,
            label: label && ts.isNamedTupleMember(label) ? label.name.text : null,
            optional: Boolean(flags & ts.ElementFlags.Optional),
            rest: Boolean(flags & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic)),
          });
        }
        node.reason = 'tuple-native-shape-unavailable';
      } else if (t.isArray() || t.isReadonlyArray()) {
        node.kind = 'array';
        node.readonly = t.isReadonlyArray();
        const item = t.getArrayElementType();
        if (item && graph.nodes.length < graph.limits.maxNodes) {
          const result = walk(item, at, true, [...keys, '[]'], depth + 1, [...path, { kind: 'item', key: 0 }], null);
          node.items = [result.id];
          if (result.shape) shape = { $type: 'array', $required: req, $items: result.shape };
        } else {
          graph.omittedCount++;
          incomplete('array-item-unavailable');
        }
      } else if (t.compilerType.flags & ts.TypeFlags.BigIntLike) {
        node.kind = 'bigint';
        node.reason = 'non-json-source-kind';
      } else if (t.compilerType.flags & ts.TypeFlags.ESSymbolLike) {
        node.kind = 'symbol';
        node.reason = 'non-json-source-kind';
      } else if (t.getCallSignatures().length) {
        node.kind = 'function';
        node.reason = 'non-json-source-kind';
        node.callSignatures = t.getCallSignatures().map((signature) => signature.getDeclaration().getText());
      } else if (t.isObject() || t.isIntersection()) node.kind = 'record';
      else {
        incomplete('native-kind-unavailable');
      }
      if (node.kind === 'record' || node.kind === 'intersection' || node.kind === 'function') {
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
            [...path, { kind: 'field', key: symbol.getName() }],
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
                valueNodeId: walk(
                  index,
                  at,
                  false,
                  [...keys, `[${key}]`],
                  depth + 1,
                  [...path, { kind: 'index', key }],
                  null,
                ).id,
              });
            else {
              graph.omittedCount++;
              incomplete('index-budget');
            }
            node.reason ??= 'open-index-signature';
            all = false;
          }
        if (all && node.fields.length && node.kind !== 'function')
          shape = { $type: 'record', $required: req, $fields: fields };
        else if (!node.fields.length) {
          node.callSignatures = t.getCallSignatures().map((signature) => signature.getDeclaration().getText());
          node.reason = node.callSignatures.length ? 'callable-or-empty-record' : 'empty-record';
        }
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

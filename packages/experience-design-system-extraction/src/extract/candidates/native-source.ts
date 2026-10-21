import ts from 'typescript';
import { SourceValueBindings } from '../component-facts/source-value-bindings.js';
import { sourceLocation } from './source-location.js';
import { projectNativeSourceShape } from './native-source-shape.js';
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
    limits: { maxDepth: 16, maxNodes: 512, maxFields: 4096, maxEdges: 4096 },
    omittedCount: 0,
  };
  const nodes = new Map<string, SourceTypeNode>();
  const expanded = new Map<object, Map<string, string>>();
  const active = new Set<string>();
  const typeIds = new Map<object, string>();
  const declarationIds = new Map<object, string>();
  let edgeCount = 0;
  let fieldCount = 0;
  let exhausted: 'source-node-budget' | 'source-edge-budget' | undefined;
  type Request = {
    type: Type;
    at: Node;
    required: boolean;
    keys: string[];
    path: NonNullable<SourceTypeNode['path']>;
    syntax: Node | null;
  };
  const incomplete = (node: SourceTypeNode, reason: string, omitted = 0): void => {
    node.reason = reason;
    node.coverage = 'partial';
    graph.coverage = 'partial';
    graph.omittedCount += omitted;
  };
  const identity = (t: Type): NonNullable<SourceTypeNode['compilerIdentity']> => {
    let typeId = typeIds.get(t.compilerType);
    if (!typeId) {
      typeId = `compiler-type-${typeIds.size}`;
      typeIds.set(t.compilerType, typeId);
    }
    const symbol = (t.getAliasSymbol() ?? t.getSymbol())?.compilerSymbol;
    let declarationId = symbol && declarationIds.get(symbol);
    if (symbol && !declarationId) {
      declarationId = `declaration-${declarationIds.size}`;
      declarationIds.set(symbol, declarationId);
    }
    return { typeId, ...(declarationId ? { declarationId } : {}) };
  };
  const visit = function* (request: Request): Generator<Request, string | undefined, string | undefined> {
    const { type: t, at, required: req, keys, path, syntax } = request;
    const { facts: nullability, syntaxDeclarations } = sourceNullability(t, at, syntax);
    const structural =
      t.isObject() || t.isIntersection() || (t.isUnion() && t.getUnionTypes().some((part) => part.isObject()));
    const context = JSON.stringify(nullability);
    const knownId = structural ? expanded.get(t.compilerType)?.get(context) : undefined;
    if (knownId && !active.has(knownId)) return knownId;
    if (graph.nodes.length >= graph.limits.maxNodes) {
      exhausted = 'source-node-budget';
      return;
    }
    const compilerIdentity = identity(t);
    const id = `s${createHash('sha256')
      .update(JSON.stringify([path, compilerIdentity, location(at)]))
      .digest('hex')
      .slice(0, 24)}`;
    const syntaxUsed = nullability.null.source === 'syntax' || nullability.undefined.source === 'syntax';
    const node: SourceTypeNode = {
      id,
      keyPath: keys,
      path,
      compilerIdentity,
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
    nodes.set(id, node);
    if (knownId) {
      node.kind = 'reference';
      node.reason = 'cycle-reference';
      if (edgeCount < graph.limits.maxEdges!) {
        node.alternatives = [knownId];
        edgeCount++;
      } else {
        exhausted = 'source-edge-budget';
        incomplete(node, exhausted, 1);
      }
      return id;
    }
    if (structural) {
      const contexts = expanded.get(t.compilerType) ?? new Map<string, string>();
      contexts.set(context, id);
      expanded.set(t.compilerType, contexts);
      active.add(id);
    }
    if (node.domain.unrepresentedValues?.length) incomplete(node, 'unsafe-domain-literal');
    const childRequest = (
      child: Type,
      kind: NonNullable<SourceTypeNode['path']>[number]['kind'],
      key: string | number,
      childRequired = req,
      declaration = at,
      childSyntax: Node | null = null,
    ): Request => ({
      type: child,
      at: declaration,
      required: childRequired,
      keys:
        kind === 'field' || kind === 'tuple'
          ? [...keys, String(key)]
          : kind === 'item'
            ? [...keys, '[]']
            : kind === 'index'
              ? [...keys, `[${key}]`]
              : keys,
      path: [...path, { kind, key }],
      syntax: childSyntax,
    });
    if (t.isString() || t.isStringLiteral()) node.kind = 'string';
    else if (t.isNumber() || t.isNumberLiteral()) node.kind = 'number';
    else if (t.isBoolean() || t.isBooleanLiteral()) node.kind = 'boolean';
    else if (t.isNull() || t.isUndefined() || t.isNever())
      node.kind = t.isNull() ? 'null' : t.isUndefined() ? 'undefined' : 'never';
    else if (t.isUnion() || t.isIntersection()) {
      node.kind = t.isUnion() ? 'union' : 'intersection';
      node.alternatives = [];
      const alternatives = t.isUnion() ? t.getUnionTypes() : (t as Type).getIntersectionTypes();
      for (const [index, alternative] of alternatives.entries()) {
        const child = yield childRequest(alternative, t.isUnion() ? 'union' : 'intersection', index);
        if (child) node.alternatives.push(child);
        else {
          incomplete(node, exhausted ?? 'alternative-unavailable', alternatives.length - index);
          break;
        }
      }
      if (node.kind === 'union') {
        const members = node.alternatives.map((ref) => nodes.get(ref)!);
        const complete =
          members.length === alternatives.length &&
          members.every((member) => member.coverage === 'complete-within-declared-bound');
        node.discriminatorKeys = complete
          ? (members[0]?.fields ?? [])
              .filter((field) => {
                const values: SourceJsonValue[] = [];
                return members.every((member) => {
                  const edge = member.fields?.find((other) => other.key === field.key);
                  const tag = edge && nodes.get(edge.nodeId);
                  if (
                    !edge?.required ||
                    !tag ||
                    tag.domain.provenance !== 'compiler' ||
                    tag.domain.openness !== 'closed' ||
                    tag.domain.declaredValues.length !== 1 ||
                    values.some((value) => value === tag.domain.declaredValues[0])
                  )
                    return false;
                  values.push(tag.domain.declaredValues[0]!);
                  return true;
                });
              })
              .map((field) => field.key)
          : [];
        node.discriminator = { provenance: 'compiler', complete, keys: node.discriminatorKeys };
      }
    } else if (t.isTuple()) {
      node.kind = 'tuple';
      node.items = [];
      node.tupleElements = [];
      const target = (t.compilerType as unknown as ts.TupleTypeReference).target;
      node.readonly = target.readonly;
      const elements = t.getTupleElements();
      for (const [index, item] of elements.entries()) {
        const flags = target.elementFlags[index] ?? ts.ElementFlags.Required;
        const child = yield childRequest(item, 'tuple', index, !(flags & ts.ElementFlags.Optional));
        if (!child) {
          incomplete(node, exhausted ?? 'tuple-item-unavailable', elements.length - index);
          break;
        }
        const label = target.labeledElementDeclarations?.[index];
        node.items.push(child);
        node.tupleElements.push({
          nodeId: child,
          label: label && ts.isNamedTupleMember(label) ? label.name.text : null,
          optional: Boolean(flags & ts.ElementFlags.Optional),
          rest: Boolean(flags & (ts.ElementFlags.Rest | ts.ElementFlags.Variadic)),
        });
      }
      node.reason ??= 'tuple-native-shape-unavailable';
    } else if (t.isArray() || t.isReadonlyArray()) {
      node.kind = 'array';
      node.readonly = t.isReadonlyArray();
      const item = t.getArrayElementType();
      const child = item ? yield childRequest(item, 'item', 0, true) : undefined;
      node.items = child ? [child] : [];
      if (!child) incomplete(node, exhausted ?? 'array-item-unavailable', 1);
    } else if (t.compilerType.flags & ts.TypeFlags.BigIntLike) {
      node.kind = 'bigint';
      node.reason = 'non-json-source-kind';
    } else if (t.compilerType.flags & ts.TypeFlags.ESSymbolLike) {
      node.kind = 'symbol';
      node.reason = 'non-json-source-kind';
    } else if (t.getCallSignatures().length || t.getConstructSignatures().length) {
      node.kind = 'function';
      node.callSignatures = [
        ...new Set(
          [...t.getCallSignatures(), ...t.getConstructSignatures()].map((signature) =>
            signature.getDeclaration().getText(),
          ),
        ),
      ];
      incomplete(node, 'callable-source-kind');
    } else if (t.isObject()) node.kind = 'record';
    else incomplete(node, 'native-kind-unavailable');
    if (['record', 'intersection', 'function'].includes(node.kind) && !exhausted) {
      node.fields = [];
      const rawProperties = t.compilerType.getProperties();
      graph.used!.propertyEnumerations++;
      graph.used!.enumeratedProperties += rawProperties.length;
      const remaining = graph.limits.maxFields - fieldCount;
      const properties =
        rawProperties.length > remaining
          ? rawProperties.slice(0, remaining).map((symbol) => t.getProperty(symbol.name)!)
          : t.getProperties();
      graph.used!.wrappedProperties += properties.length;
      for (const [index, symbol] of properties.entries()) {
        if (fieldCount >= graph.limits.maxFields) {
          incomplete(node, 'source-field-budget', rawProperties.length - index);
          break;
        }
        fieldCount++;
        const declarations = symbol.getDeclarations();
        const declaration = declarations[0] ?? at;
        const child = yield childRequest(
          symbol.getTypeAtLocation(at),
          'field',
          symbol.getName(),
          !symbol.isOptional(),
          declaration,
          declarationType(declaration),
        );
        if (!child) {
          incomplete(node, exhausted ?? 'field-unavailable', rawProperties.length - index);
          break;
        }
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
        const readonly = declarations.some(
          (member) =>
            Node.isGetAccessorDeclaration(member) ||
            ((Node.isPropertySignature(member) || Node.isPropertyDeclaration(member)) &&
              member.hasModifier(ts.SyntaxKind.ReadonlyKeyword)),
        );
        node.fields.push({
          key: symbol.getName(),
          path: [...path, { kind: 'field', key: symbol.getName() }],
          nodeId: child,
          required: !symbol.isOptional(),
          readonly,
          declarations: declarations.map(location),
          ...(description ? { description } : {}),
        });
      }
      if (!exhausted && rawProperties.length > properties.length)
        incomplete(node, 'source-field-budget', rawProperties.length - properties.length);
      node.indexSignatures = [];
      for (const [key, index] of [
        ['string', t.getStringIndexType()],
        ['number', t.getNumberIndexType()],
      ] as const) {
        if (!index) continue;
        const child = yield childRequest(index, 'index', key, false);
        if (child) node.indexSignatures.push({ keyType: key, valueNodeId: child });
        else incomplete(node, exhausted ?? 'index-unavailable', 1);
        node.reason ??= 'open-index-signature';
        if (exhausted) break;
      }
      if (!node.fields.length) node.reason ??= 'empty-record';
    }
    active.delete(id);
    return id;
  };
  const frames = [
    visit({
      type,
      at: fallback,
      required,
      keys: keyPath,
      path: keyPath.map((key) => ({ kind: 'field', key })),
      syntax: declarationType(fallback),
    }),
  ];
  let returnedId: string | undefined;
  while (frames.length) {
    const result = frames[frames.length - 1]!.next(returnedId);
    returnedId = undefined;
    if (result.done) {
      frames.pop();
      returnedId = result.value;
      if (!frames.length) graph.rootId = result.value!;
    } else if (exhausted || edgeCount >= graph.limits.maxEdges!) {
      exhausted ??= 'source-edge-budget';
    } else {
      edgeCount++;
      frames.push(visit(result.value));
    }
  }
  graph.resources = {
    nodes: graph.nodes.length,
    edges: graph.nodes.reduce(
      (count, node) =>
        count +
        (node.fields?.length ?? 0) +
        (node.items?.length ?? 0) +
        (node.alternatives?.length ?? 0) +
        (node.indexSignatures?.length ?? 0),
      0,
    ),
  };
  const projected = projectNativeSourceShape(graph);
  return {
    graph,
    ...projected,
    notes: [...graph.nodes.flatMap((node) => (node.reason ? [`${node.id}: ${node.reason}`] : [])), ...projected.notes],
  };
}

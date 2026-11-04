import ts from 'typescript';
import { resolve } from 'node:path';
import type { SourceFactLocation } from '../candidates/types.js';
import type {
  SourceInputOutputEvidence,
  SourceInputOutputWitness,
  SourceOutputDestination,
} from '../types/source-input-output.js';
import { SourceObservationReader, isWithinSourceBoundary, sourceRealPath } from './source-observation-reader.js';
import { SourceValueBindings } from './source-value-bindings.js';
import { readIntrinsicChildGrammar } from './intrinsic-child-grammar.js';

type Callable = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const callable = (node: ts.Node): node is Callable =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);
interface Dependency {
  inputName: string;
  inputPath: string[];
  rootSymbolId: string;
  via: SourceFactLocation[];
  reasons: string[];
  conditions: SourceInputOutputWitness['conditions'];
  enclosing?: SourceOutputDestination[];
}
interface Value {
  dependencies: Dependency[];
  fields?: Map<string, Value>;
  targets?: Array<{ node: Callable; conditions: SourceInputOutputWitness['conditions'] }>;
  literal?: string;
  intrinsics?: Array<{ name: string; conditions: SourceInputOutputWitness['conditions'] }>;
  unknownFields?: Value;
  reasons: string[];
}
interface Context {
  context: SourceInputOutputWitness['context'];
  conditions: SourceInputOutputWitness['conditions'];
  enclosing: SourceOutputDestination[];
  env: Map<ts.Declaration, Value>;
  active: Set<ts.Node>;
  depth: number;
}
const empty = (): Value => ({ dependencies: [], reasons: [] });
const join = (values: Value[]): Value => ({
  dependencies: values.flatMap((value) => value.dependencies),
  reasons: [...new Set(values.flatMap((value) => value.reasons))],
  targets: values.flatMap((value) => value.targets ?? []),
  intrinsics: values.flatMap((value) => value.intrinsics ?? []),
});
function uncertain(value: Value, reason: string): Value {
  return {
    ...value,
    reasons: [...new Set([...value.reasons, reason])],
    dependencies: value.dependencies.map((dependency) => ({
      ...dependency,
      reasons: [...new Set([...dependency.reasons, reason])],
    })),
    ...(value.fields
      ? { fields: new Map([...value.fields].map(([key, field]) => [key, uncertain(field, reason)])) }
      : {}),
    targets: [],
    intrinsics: [],
  };
}

/** Return and receiver relationships use compiler bindings and grammar, independently of lexical closure. */
export function collectInputOutput(
  node: Callable,
  reader: SourceObservationReader,
  signal?: AbortSignal,
): SourceInputOutputEvidence {
  const limits = reader.collection.limits;
  const bindings = new SourceValueBindings(reader.checker);
  const evidence: SourceInputOutputEvidence = {
    schemaVersion: 1,
    semantics: 'bounded-source-dependencies',
    componentDeclarationId: reader.identity(node),
    coverage: 'complete-within-declared-bound',
    inputs: [],
    witnesses: [],
    summaries: [],
    omissions: [],
    used: { nodes: 0, maxDepth: 0, witnesses: 0 },
  };
  const omitted = (reason: string, site: ts.Node): void => {
    evidence.coverage = 'partial';
    if (
      !evidence.omissions.some(
        (item) =>
          item.reason === reason &&
          item.location?.startOffset === site.getStart() &&
          item.location?.canonicalPath === reader.location(site).canonicalPath,
      )
    )
      evidence.omissions.push({ reason, location: reader.location(site) });
  };
  if (!bindings.scan(node.getSourceFile(), limits.maxNodes)) omitted('write-scan-bound', node);
  const initial: Context = {
    context: 'returned',
    conditions: [],
    enclosing: [],
    env: new Map(),
    active: new Set(),
    depth: 0,
  };
  const rootParameter = node.parameters[0];
  if (rootParameter) {
    const rootId = reader.identity(rootParameter);
    const fields = new Map<string, Value>();
    for (const property of reader.checker.getTypeAtLocation(rootParameter).getProperties()) {
      const name = property.getName();
      const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? rootParameter;
      evidence.inputs.push({
        name,
        rootSymbolId: rootId,
        declaration: reader.location(declaration),
        parameterIndex: 0,
        inputPath: [name],
      });
      fields.set(name, {
        dependencies: [
          {
            inputName: name,
            inputPath: [name],
            rootSymbolId: rootId,
            via: [reader.location(declaration)],
            reasons: [],
            conditions: [],
          },
        ],
        reasons: [],
      });
    }
    bind(rootParameter, { ...join([...fields.values()]), fields }, initial);
  }
  evidence.inputs.sort((a, b) => a.name.localeCompare(b.name));
  function admit(site: ts.Node, context: Context): boolean {
    evidence.used.maxDepth = Math.max(evidence.used.maxDepth, context.depth);
    if (signal?.aborted) {
      omitted('collection-cancelled', site);
      return false;
    }
    if (context.depth > limits.maxDepth) {
      omitted('output-depth-bound', site);
      return false;
    }
    if (evidence.used.nodes >= limits.maxNodes) {
      omitted('output-node-bound', site);
      return false;
    }
    evidence.used.nodes++;
    return true;
  }
  function emit(
    value: Value,
    kind: SourceInputOutputWitness['kind'],
    site: ts.Node,
    context: Context,
    destination: SourceOutputDestination | null = null,
  ): void {
    for (const dependency of value.dependencies) {
      if (evidence.witnesses.length >= limits.maxObservations) {
        omitted('output-witness-bound', site);
        break;
      }
      const reasons = [...new Set(dependency.reasons)].sort();
      const conditions = [
        ...new Map(
          [...context.conditions, ...dependency.conditions].map((condition) => [JSON.stringify(condition), condition]),
        ).values(),
      ];
      const witness: SourceInputOutputWitness = {
        id: '',
        inputName: dependency.inputName,
        inputPath: dependency.inputPath,
        rootSymbolId: dependency.rootSymbolId,
        kind,
        context: context.context,
        location: reader.location(site),
        destination,
        enclosing: [
          ...new Map(
            [...context.enclosing, ...(dependency.enclosing ?? [])].map((owner) => [JSON.stringify(owner), owner]),
          ).values(),
        ],
        via: dependency.via,
        conditions,
        strength: reasons.length ? 'unknown' : dependency.via.length > 1 ? 'inferred' : 'exact',
        reasons,
      };
      const key = JSON.stringify(witness);
      if (evidence.witnesses.some((previous) => JSON.stringify({ ...previous, id: '' }) === key)) continue;
      witness.id = `${reader.identity(site)}:output:${evidence.witnesses.length}`;
      evidence.witnesses.push(witness);
    }
  }
  function bind(
    declaration: ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement,
    value: Value,
    context: Context,
  ): void {
    context.env.set(declaration, value);
    if (ts.isIdentifier(declaration.name)) return;
    const consumed = new Set<string>();
    declaration.name.elements.forEach((element, index) => {
      if (!ts.isBindingElement(element)) return;
      const name = bindings.key(element.propertyName ?? (element.name as ts.PropertyName));
      const key = ts.isArrayBindingPattern(declaration.name) ? String(index) : name;
      if (element.dotDotDotToken) {
        const fields = value.fields ? new Map([...value.fields].filter(([name]) => !consumed.has(name))) : undefined;
        bind(
          element,
          fields ? { ...join([...fields.values()]), fields } : uncertain(value, 'rest-members-unavailable'),
          context,
        );
      } else {
        if (key !== null) consumed.add(key);
        let member =
          key !== null && value.fields?.has(key)
            ? value.fields.get(key)!
            : uncertain(value, 'input-member-unavailable');
        if (element.initializer) member = join([member, evaluate(element.initializer, context)]);
        bind(element, member, context);
      }
    });
  }
  function declarationValue(declaration: ts.Declaration | undefined, site: ts.Node, context: Context): Value {
    if (!declaration) {
      omitted('value-declaration-unavailable', site);
      return { ...empty(), reasons: ['value-declaration-unavailable'] };
    }
    if (context.active.has(declaration) && !callable(declaration)) {
      omitted('value-alias-cycle', site);
      return { ...empty(), reasons: ['value-alias-cycle'] };
    }
    const next = { ...context, active: new Set([...context.active, declaration]), depth: context.depth + 1 };
    let value = context.env.get(declaration);
    if (!value && callable(declaration))
      value = { ...empty(), targets: [{ node: declaration, conditions: context.conditions }] };
    if (!value && ts.isVariableDeclaration(declaration) && declaration.initializer)
      value = evaluate(declaration.initializer, next);
    if (!value && ts.isBindingElement(declaration)) {
      const owner = declaration.parent.parent;
      if (ts.isParameter(owner) || ts.isVariableDeclaration(owner) || ts.isBindingElement(owner)) {
        const source = declarationValue(owner, site, next);
        const env = new Map(context.env);
        bind(owner, source, { ...next, env });
        value = env.get(declaration);
      }
    }
    if (!value) return { ...empty(), reasons: ['value-unavailable'] };
    if (bindings.mutated(declaration)) {
      omitted('binding-written', declaration);
      return uncertain(value, 'binding-written');
    }
    return {
      ...value,
      dependencies: value.dependencies.map((dependency) => ({
        ...dependency,
        via: [...dependency.via, reader.location(site)],
        conditions: [...dependency.conditions, ...context.conditions],
      })),
    };
  }
  function branch(
    context: Context,
    expression: ts.Node,
    alternative: SourceInputOutputWitness['conditions'][number]['branch'],
  ): Context {
    emit(evaluate(expression, { ...context, context: 'referenced' }), 'guard', expression, context);
    return {
      ...context,
      conditions: [
        ...context.conditions,
        { expression: expression.getText(), branch: alternative, location: reader.location(expression) },
      ],
    };
  }
  function invoke(target: Callable, arguments_: Value[], site: ts.Node, context: Context): Value {
    const path = sourceRealPath(target.getSourceFile().fileName) ?? resolve(target.getSourceFile().fileName);
    const rootPath = sourceRealPath(node.getSourceFile().fileName) ?? resolve(node.getSourceFile().fileName);
    if (
      !target.body ||
      target.getSourceFile().isDeclarationFile ||
      (path !== rootPath &&
        (!reader.collection.repositoryRoot || !isWithinSourceBoundary(reader.collection.repositoryRoot, path)))
    ) {
      const reason =
        !target.body || target.getSourceFile().isDeclarationFile
          ? 'declaration-body-unavailable'
          : 'external-body-unavailable';
      omitted(reason, site);
      return uncertain(join(arguments_), reason);
    }
    if (context.active.has(target)) {
      omitted('recursive-output-open', site);
      return uncertain(join(arguments_), 'recursive-output-open');
    }
    if (!bindings.scan(target.getSourceFile(), limits.maxNodes)) omitted('write-scan-bound', target);
    const next: Context = {
      ...context,
      env: new Map(context.env),
      active: new Set([...context.active, target]),
      depth: context.depth + 1,
    };
    target.parameters.forEach((parameter, index) => {
      let value = arguments_[index] ?? empty();
      if (parameter.dotDotDotToken) {
        const fields = new Map(arguments_.slice(index).map((argument, position) => [String(position), argument]));
        value = { ...join([...fields.values()]), fields };
      }
      if (parameter.initializer) value = join([value, evaluate(parameter.initializer, next)]);
      bind(parameter, value, next);
    });
    const value = body(target.body, next);
    return {
      ...value,
      dependencies: value.dependencies.map((dependency) => ({
        ...dependency,
        enclosing: [...(dependency.enclosing ?? []), ...next.enclosing],
      })),
    };
  }
  function object(node: ts.ObjectLiteralExpression, context: Context): Value {
    const fields = new Map<string, Value>();
    let unknown = empty();
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const source = evaluate(property.expression, context);
        if (!source.fields || source.unknownFields?.dependencies.length) {
          for (const [key, value] of fields) fields.set(key, uncertain(value, 'unknown-spread-overwrite'));
          unknown = join([unknown, uncertain(source.unknownFields ?? source, 'unknown-spread-overwrite')]);
          omitted('unknown-spread-overwrite', property);
        }
        if (source.fields) for (const [key, value] of source.fields) fields.set(key, value);
      } else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
        const key = bindings.key(property.name);
        const value = ts.isPropertyAssignment(property)
          ? evaluate(property.initializer, context)
          : declarationValue(bindings.declaration(property), property, context);
        if (key === null) {
          for (const [name, previous] of fields) fields.set(name, uncertain(previous, 'computed-key-unavailable'));
          unknown = join([unknown, uncertain(value, 'computed-key-unavailable')]);
          omitted('computed-key-unavailable', property);
        } else fields.set(key, value);
      } else {
        omitted('object-member-unsupported', property);
      }
    }
    return { ...join([...fields.values(), unknown]), fields, unknownFields: unknown };
  }
  function destination(
    tag: ts.JsxTagNameExpression,
    inputName: string,
    target?: Callable,
    intrinsicName?: string,
  ): SourceOutputDestination {
    return {
      kind: intrinsicName
        ? 'intrinsic'
        : target
          ? 'callable'
          : ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)
            ? 'intrinsic'
            : 'unknown',
      name: intrinsicName ?? tag.getText(),
      inputName,
      declarationId: target ? reader.identity(target) : null,
      location: reader.location(tag),
    };
  }
  function jsx(site: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment, context: Context): Value {
    if (ts.isJsxFragment(site))
      return join(site.children.flatMap((child) => (ts.isJsxText(child) ? [] : [evaluate(child, context)])));
    const opening = ts.isJsxElement(site) ? site.openingElement : site;
    const tag = opening.tagName;
    const intrinsic = ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
    const targets = intrinsic ? empty() : evaluate(tag, { ...context, context: 'referenced' });
    const intrinsicNames = intrinsic
      ? [{ name: tag.getText(), conditions: context.conditions }]
      : (targets.intrinsics ?? []);
    const owner = destination(tag, 'children', targets.targets?.[0]?.node);
    const supplied: Context = {
      ...context,
      // Supplied expressions remain references until effective receiver delivery is known.
      context: 'referenced',
      enclosing: [...context.enclosing, owner],
      depth: context.depth + 1,
    };
    const fields = new Map<string, Value>();
    let unknown = empty();
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        const value = evaluate(attribute.expression, supplied);
        if (!value.fields || value.unknownFields?.dependencies.length) {
          for (const [key, previous] of fields) fields.set(key, uncertain(previous, 'unknown-spread-overwrite'));
          unknown = join([unknown, uncertain(value.unknownFields ?? value, 'unknown-spread-overwrite')]);
          omitted('unknown-spread-overwrite', attribute);
        }
        if (value.fields) for (const [key, field] of value.fields) fields.set(key, field);
      } else {
        const value =
          attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression
            ? evaluate(attribute.initializer.expression, supplied)
            : empty();
        fields.set(attribute.name.getText(), value);
      }
    }
    if (ts.isJsxElement(site)) {
      const children = site.children.filter((child) => !ts.isJsxText(child) || child.text.trim());
      if (children.length) fields.set('children', join(children.map((child) => evaluate(child, supplied))));
    }
    const intrinsicResults: Value[] = [];
    for (const route of intrinsicNames) {
      const intrinsicName = route.name;
      const intrinsicContext = { ...context, conditions: [...context.conditions, ...route.conditions] };
      const childGrammar = readIntrinsicChildGrammar(intrinsicName);
      const effective = new Map(fields);
      if (childGrammar === 'discarded') effective.delete('children');
      else if (childGrammar === 'unavailable' && effective.has('children')) {
        effective.set('children', uncertain(effective.get('children')!, 'intrinsic-child-context-unavailable'));
        omitted('intrinsic-child-context-unavailable', site);
      }
      for (const [name, value] of fields)
        emit(
          name === 'children' && childGrammar === 'unavailable'
            ? uncertain(value, 'intrinsic-child-context-unavailable')
            : value,
          name === 'children'
            ? childGrammar === 'discarded'
              ? 'receiver-input'
              : 'returned-value'
            : 'intrinsic-attribute',
          site,
          intrinsicContext,
          destination(tag, name, undefined, intrinsicName),
        );
      if (unknown.dependencies.length)
        emit(unknown, 'intrinsic-attribute', site, intrinsicContext, destination(tag, '*', undefined, intrinsicName));
      const value = join([...effective.values(), unknown]);
      intrinsicResults.push({
        ...value,
        dependencies: value.dependencies.map((dependency) => ({
          ...dependency,
          conditions: [...dependency.conditions, ...route.conditions],
        })),
      });
    }
    if (intrinsic) return join(intrinsicResults);
    for (const [name, value] of fields)
      emit(value, 'receiver-input', site, context, destination(tag, name, targets.targets?.[0]?.node));
    const props = { ...join([...fields.values(), unknown]), fields };
    const results = [
      ...intrinsicResults,
      ...(targets.targets ?? []).map((route) =>
        invoke(route.node, [props], site, {
          ...context,
          conditions: [...context.conditions, ...route.conditions],
          enclosing: [...context.enclosing, destination(tag, 'children', route.node)],
        }),
      ),
    ];
    if (!results.length || targets.reasons.length) {
      omitted('receiver-output-unavailable', site);
      results.push(uncertain(join([targets, props]), 'receiver-output-unavailable'));
    }
    return join(results);
  }
  function evaluate(site: ts.Node, context: Context): Value {
    if (!admit(site, context)) return { ...empty(), reasons: ['output-read-bound'] };
    const next = { ...context, depth: context.depth + 1 };
    if (
      ts.isParenthesizedExpression(site) ||
      ts.isAsExpression(site) ||
      ts.isTypeAssertionExpression(site) ||
      ts.isNonNullExpression(site) ||
      ts.isSatisfiesExpression(site) ||
      ts.isJsxExpression(site)
    )
      return site.expression ? evaluate(site.expression, next) : empty();
    if (callable(site)) return { ...empty(), targets: [{ node: site, conditions: context.conditions }] };
    if (ts.isIdentifier(site)) {
      const declaration = bindings.declaration(site);
      return declaration ? declarationValue(declaration, site, next) : { ...empty(), reasons: ['unresolved-value'] };
    }
    if (ts.isStringLiteralLike(site) || ts.isNumericLiteral(site))
      return {
        ...empty(),
        literal: site.text,
        intrinsics: ts.isStringLiteralLike(site) ? [{ name: site.text, conditions: context.conditions }] : [],
      };
    if (ts.isPropertyAccessExpression(site) || ts.isElementAccessExpression(site)) {
      const base = evaluate(site.expression, next);
      const key = ts.isPropertyAccessExpression(site) ? site.name.text : bindings.constant(site.argumentExpression);
      if (key !== null && base.fields?.has(key)) {
        const value = base.fields.get(key)!;
        return {
          ...value,
          dependencies: value.dependencies.map((dependency) => ({
            ...dependency,
            via: [...dependency.via, reader.location(site)],
            conditions: [...dependency.conditions, ...context.conditions],
          })),
        };
      }
      if (key === null) {
        omitted('computed-key-unavailable', site);
        return uncertain(base, 'computed-key-unavailable');
      }
      const declaration = bindings.declaration(ts.isPropertyAccessExpression(site) ? site.name : site);
      if (declaration && callable(declaration)) return declarationValue(declaration, site, next);
      return {
        ...base,
        dependencies: base.dependencies.map((dependency) => ({
          ...dependency,
          inputPath: [...dependency.inputPath, key],
          via: [...dependency.via, reader.location(site)],
        })),
      };
    }
    if (ts.isConditionalExpression(site))
      return join([
        evaluate(site.whenTrue, branch(next, site.condition, 'truthy')),
        evaluate(site.whenFalse, branch(next, site.condition, 'falsy')),
      ]);
    if (ts.isBinaryExpression(site)) {
      if (
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(site.operatorToken.kind)
      ) {
        const alternative =
          site.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
            ? 'truthy'
            : site.operatorToken.kind === ts.SyntaxKind.BarBarToken
              ? 'falsy'
              : 'nullish';
        const right = evaluate(site.right, branch(next, site.left, alternative));
        return site.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          ? right
          : join([evaluate(site.left, next), right]);
      }
      if (
        site.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        site.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        return uncertain(evaluate(site.right, next), 'assignment-expression');
      return join([evaluate(site.left, next), evaluate(site.right, next)]);
    }
    if (ts.isCallExpression(site)) {
      const target = evaluate(site.expression, next);
      const arguments_ = site.arguments.map((argument) => evaluate(argument, { ...next, context: 'referenced' }));
      const results = (target.targets ?? []).map((route) =>
        invoke(route.node, arguments_, site, { ...next, conditions: [...next.conditions, ...route.conditions] }),
      );
      if (!results.length || target.reasons.length) {
        omitted('call-result-unavailable', site);
        results.push(uncertain(join([target, ...arguments_]), 'call-result-unavailable'));
      }
      return join(results);
    }
    if (ts.isObjectLiteralExpression(site)) return object(site, next);
    if (ts.isArrayLiteralExpression(site)) {
      const fields = new Map(site.elements.map((element, index) => [String(index), evaluate(element, next)]));
      return { ...join([...fields.values()]), fields };
    }
    if (ts.isJsxElement(site) || ts.isJsxSelfClosingElement(site) || ts.isJsxFragment(site)) return jsx(site, next);
    if (ts.isTemplateExpression(site)) return join(site.templateSpans.map((span) => evaluate(span.expression, next)));
    if (ts.isPrefixUnaryExpression(site) || ts.isPostfixUnaryExpression(site)) return evaluate(site.operand, next);
    if (
      [
        ts.SyntaxKind.TrueKeyword,
        ts.SyntaxKind.FalseKeyword,
        ts.SyntaxKind.NullKeyword,
        ts.SyntaxKind.JsxText,
        ts.SyntaxKind.OmittedExpression,
      ].includes(site.kind)
    )
      return empty();
    omitted('expression-unsupported', site);
    return { ...empty(), reasons: ['expression-unsupported'] };
  }
  function body(site: ts.Node, context: Context): Value {
    if (!ts.isBlock(site)) {
      const value = evaluate(site, context);
      emit(value, 'returned-value', site, context);
      return value;
    }
    const returned: Value[] = [];
    const sequence = (statements: readonly ts.Statement[], scopes: Context[]): Context[] => {
      for (const statement of statements) {
        if (scopes.length === 0) break;
        scopes = scopes.flatMap((scope) => visit(statement, scope));
      }
      return scopes;
    };
    const visit = (statement: ts.Node, scope: Context): Context[] => {
      if (!admit(statement, scope)) return [];
      if (ts.isReturnStatement(statement)) {
        const value = statement.expression ? evaluate(statement.expression, scope) : empty();
        emit(value, 'returned-value', statement, scope);
        returned.push(value);
        return [];
      }
      if (ts.isThrowStatement(statement)) {
        omitted('exception-output-open', statement);
        return [];
      }
      if (ts.isIfStatement(statement)) {
        const thenScope = { ...branch(scope, statement.expression, 'then'), env: new Map(scope.env) };
        const elseScope = { ...branch(scope, statement.expression, 'else'), env: new Map(scope.env) };
        return [
          ...visit(statement.thenStatement, thenScope),
          ...(statement.elseStatement ? visit(statement.elseStatement, elseScope) : [elseScope]),
        ];
      }
      if (ts.isBlock(statement))
        return sequence(statement.statements, [{ ...scope, env: new Map(scope.env), depth: scope.depth + 1 }]);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const value = declaration.initializer
            ? evaluate(declaration.initializer, { ...scope, context: 'discarded' })
            : empty();
          bind(declaration, value, scope);
          if (declaration.initializer && callable(declaration.initializer) && declaration.initializer.body)
            body(declaration.initializer.body, {
              ...scope,
              env: new Map(scope.env),
              context: 'deferred',
              depth: scope.depth + 1,
            });
        }
      } else if (callable(statement)) {
        if (statement.body)
          body(statement.body, { ...scope, env: new Map(scope.env), context: 'deferred', depth: scope.depth + 1 });
      } else if (ts.isExpressionStatement(statement)) {
        const value = evaluate(statement.expression, { ...scope, context: 'discarded' });
        emit(value, 'returned-value', statement, { ...scope, context: 'discarded' });
      } else if (
        ts.isForOfStatement(statement) ||
        ts.isForInStatement(statement) ||
        ts.isWhileStatement(statement) ||
        ts.isDoStatement(statement) ||
        ts.isForStatement(statement)
      ) {
        omitted('loop-output-open', statement);
        visit(statement.statement, { ...scope, env: new Map(scope.env), depth: scope.depth + 1 });
      } else if (!ts.isEmptyStatement(statement)) {
        omitted('statement-unsupported', statement);
      }
      return [scope];
    };
    sequence(site.statements, [context]);
    return join(returned);
  }
  if (node.body) body(node.body, { ...initial, active: new Set([node]) });
  else omitted('component-body-unavailable', node);
  evidence.used.witnesses = evidence.witnesses.length;
  evidence.summaries = evidence.inputs.map((input) => {
    const witnesses = evidence.witnesses.filter(
      (witness) =>
        witness.inputName === input.name &&
        witness.context === 'returned' &&
        witness.kind !== 'guard' &&
        witness.kind !== 'receiver-input',
    );
    const reasons = [
      ...new Set([
        ...witnesses.flatMap((witness) => witness.reasons),
        ...evidence.omissions.map((item) => item.reason),
      ]),
    ].sort();
    return {
      inputName: input.name,
      state: witnesses.some((witness) => witness.strength !== 'unknown')
        ? 'positive'
        : reasons.length
          ? 'open'
          : 'absent',
      scope: 'component-return',
      witnessIds: witnesses.map((witness) => witness.id),
      reasons,
    };
  });
  return evidence;
}

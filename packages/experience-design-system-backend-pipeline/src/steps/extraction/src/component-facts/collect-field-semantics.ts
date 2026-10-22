import ts from 'typescript';
import { resolve } from 'node:path';
import { FIELD_SEMANTICS_VERSION, FIELD_VALUE_PREMISES, type SourceFieldSemantics } from '../types/field-semantics.js';
import { SourceObservationReader, isWithinSourceBoundary, sourceRealPath } from './source-observation-reader.js';
import { SourceValueBindings } from './source-value-bindings.js';
import { collectFieldReplay } from './collect-field-replay.js';

type Callable = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const callable = (node: ts.Node): node is Callable =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);
interface Value {
  origins: Set<string>;
  presence: Set<string>;
  fields?: Map<string, Value>;
  wildcard?: Value;
  fresh?: boolean;
  allocationFrame?: number;
  target?: Callable;
  opaqueCallable?: boolean;
}
interface Scope {
  env: Map<ts.Declaration, Value>;
  bindingFrames: Map<ts.Declaration, number>;
  control: Set<string>;
  conditions: SourceFieldSemantics['steps'][number]['conditions'];
  active: Set<ts.Node>;
  frame: number;
  depth: number;
}
const empty = (): Value => ({ origins: new Set(), presence: new Set() });
const union = (sets: Iterable<string>[]): Set<string> => new Set(sets.flatMap((set) => [...set]));
function origins(value: Value, presence = false, seen = new Set<Value>()): Set<string> {
  if (seen.has(value)) return new Set();
  seen.add(value);
  return union([
    value.origins,
    ...(presence ? [value.presence] : []),
    ...[...(value.fields?.values() ?? []), ...(value.wildcard ? [value.wildcard] : [])].map((member) =>
      origins(member, presence, seen),
    ),
  ]);
}
function merge(values: Value[]): Value {
  const result: Value = {
    origins: union(values.map((value) => value.origins)),
    presence: union(values.map((value) => value.presence)),
  };
  if (values.length && values.every((value) => value.fields)) {
    const names = new Set(values.flatMap((value) => [...value.fields!.keys()]));
    result.fields = new Map(
      [...names].map((name) => [
        name,
        merge(values.map((value) => value.fields!.get(name) ?? value.wildcard ?? empty())),
      ]),
    );
    result.fresh = values.length === 1 && values[0].fresh;
    if (values.length === 1) result.allocationFrame = values[0].allocationFrame;
  } else result.origins = union(values.map((value) => origins(value)));
  const wildcards = values.flatMap((value) => (value.wildcard ? [value.wildcard] : []));
  if (wildcards.length) result.wildcard = merge(wildcards);
  if (values.length === 1) result.target = values[0].target;
  result.opaqueCallable = values.some((value) => value.opaqueCallable);
  return result;
}
function copy(value: Value, memo = new Map<Value, Value>()): Value {
  if (memo.has(value)) return memo.get(value)!;
  const result: Value = { ...value, origins: new Set(value.origins), presence: new Set(value.presence) };
  memo.set(value, result);
  if (value.fields) result.fields = new Map([...value.fields].map(([name, field]) => [name, copy(field, memo)]));
  if (value.wildcard) result.wildcard = copy(value.wildcard, memo);
  return result;
}

/** Ordered operations over inert input values; effects and delivery remain explicit open obligations. */
export function collectFieldSemantics(
  node: Callable,
  reader: SourceObservationReader,
  signal?: AbortSignal,
): SourceFieldSemantics {
  const evidence: SourceFieldSemantics = {
    schemaVersion: FIELD_SEMANTICS_VERSION,
    semantics: 'conditional-ordered-field-flow',
    componentDeclarationId: reader.identity(node),
    source: reader.location(node),
    coverage: 'complete-within-declared-bound',
    proofs: [],
    steps: [],
    omissions: [],
    used: { nodes: 0, maxDepth: 0 },
  };
  const bindings = new SourceValueBindings(reader.checker);
  const subjects = new Map<string, string[]>();
  const limits = reader.collection.limits;
  let frame = 0;
  const omit = (reason: string, site: ts.Node): void => {
    evidence.coverage = 'partial';
    const location = reader.location(site);
    if (
      !evidence.omissions.some(
        (item) =>
          item.reason === reason &&
          item.location.canonicalPath === location.canonicalPath &&
          item.location.startOffset === location.startOffset,
      )
    )
      evidence.omissions.push({ reason, location });
  };
  const admit = (site: ts.Node, depth: number): boolean => {
    evidence.used.maxDepth = Math.max(evidence.used.maxDepth, depth);
    if (signal?.aborted) {
      omit('field-flow-cancelled', site);
      return false;
    }
    if (depth > limits.maxDepth || evidence.used.nodes >= limits.maxNodes) {
      omit('field-flow-bound', site);
      return false;
    }
    evidence.used.nodes++;
    return true;
  };
  const step = (operation: SourceFieldSemantics['steps'][number]['operation'], site: ts.Node, scope: Scope): void => {
    if (evidence.steps.length >= limits.maxObservations) {
      omit('field-flow-step-bound', site);
      return;
    }
    evidence.steps.push({
      operation,
      frame: scope.frame,
      location: reader.location(site),
      conditions: scope.conditions,
    });
  };
  function sourceValue(type: ts.Type, path: string[], site: ts.Node, depth: number, active: Set<ts.Type>): Value {
    const key = JSON.stringify(path);
    const inherited = new Set(path.map((_, index) => JSON.stringify(path.slice(0, index + 1))));
    const value: Value = { origins: inherited, presence: new Set(inherited) };
    if (path.length && !subjects.has(key) && subjects.size >= limits.maxObservations) {
      omit('field-subject-bound', site);
      return value;
    }
    if (path.length) subjects.set(key, path);
    if (!admit(site, depth)) return value;
    value.opaqueCallable = type.getCallSignatures().length > 0;
    if (!(type.flags & ts.TypeFlags.Object) || reader.checker.isArrayType(type) || reader.checker.isTupleType(type))
      return value;
    if (active.has(type)) {
      omit('recursive-input-shape-open', site);
      return value;
    }
    const next = new Set([...active, type]);
    value.fields = new Map();
    for (const property of type.getProperties()) {
      if (evidence.used.nodes >= limits.maxNodes) {
        omit('field-flow-bound', site);
        break;
      }
      const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? site;
      value.fields.set(
        property.getName(),
        sourceValue(
          reader.checker.getTypeOfSymbolAtLocation(property, declaration),
          [...path, property.getName()],
          declaration,
          depth + 1,
          next,
        ),
      );
    }
    value.wildcard = { origins: new Set(inherited), presence: new Set(inherited) };
    return value;
  }
  function bind(
    declaration: ts.ParameterDeclaration | ts.VariableDeclaration | ts.BindingElement,
    value: Value,
    scope: Scope,
  ): void {
    scope.env.set(declaration, value);
    scope.bindingFrames.set(declaration, scope.frame);
    step('binding', declaration, scope);
    if (ts.isIdentifier(declaration.name)) return;
    if (ts.isArrayBindingPattern(declaration.name)) {
      omit('array-binding-open', declaration);
      return;
    }
    const consumed = new Set<string>();
    for (const element of declaration.name.elements) {
      if (element.dotDotDotToken) {
        const rest = copy(value);
        if (rest.fields) for (const name of consumed) rest.fields.delete(name);
        bind(element, rest, scope);
      } else {
        const name = bindings.key(element.propertyName ?? (element.name as ts.PropertyName));
        if (name === null) {
          omit('computed-binding-open', element);
          continue;
        }
        consumed.add(name);
        let field = value.fields?.get(name) ?? value.wildcard ?? value;
        if (element.initializer) field = merge([field, evaluate(element.initializer, scope)]);
        bind(element, field, scope);
      }
    }
  }
  function lookup(site: ts.Node, scope: Scope): Value {
    const declaration = bindings.declaration(site);
    if (!declaration) {
      omit('field-value-unresolved', site);
      return empty();
    }
    const saved = scope.env.get(declaration);
    if (saved) return saved;
    if (!bindings.scan(declaration.getSourceFile(), Math.max(0, limits.maxNodes - bindings.scanNodes))) {
      omit('field-write-scan-bound', site);
      return empty();
    }
    if (bindings.mutated(declaration)) {
      omit('external-binding-written', site);
      return empty();
    }
    if (callable(declaration)) return { ...empty(), target: declaration };
    if (scope.active.has(declaration)) {
      omit('field-alias-cycle-open', site);
      return empty();
    }
    // Initializers outside the executed environment do not establish a runtime value.
    omit('field-value-unavailable', site);
    return empty();
  }
  function split(scope: Scope, expression: ts.Expression, branch: 'then' | 'else' | 'truthy' | 'falsy'): Scope {
    const memo = new Map<Value, Value>();
    const condition = evaluate(expression, scope);
    step('branch', expression, scope);
    return {
      ...scope,
      env: new Map([...scope.env].map(([key, value]) => [key, copy(value, memo)])),
      control: union([scope.control, origins(condition)]),
      conditions: [
        ...scope.conditions,
        { expression: expression.getText(), branch, location: reader.location(expression) },
      ],
      depth: scope.depth + 1,
    };
  }
  function evaluate(site: ts.Node, scope: Scope): Value {
    if (!admit(site, scope.depth)) return empty();
    const next = { ...scope, depth: scope.depth + 1 };
    if (
      ts.isParenthesizedExpression(site) ||
      ts.isAsExpression(site) ||
      ts.isNonNullExpression(site) ||
      ts.isTypeAssertionExpression(site) ||
      ts.isSatisfiesExpression(site)
    )
      return evaluate(site.expression, next);
    if (ts.isIdentifier(site)) return lookup(site, next);
    if (callable(site)) return { ...empty(), target: site };
    if (
      ts.isStringLiteralLike(site) ||
      ts.isNumericLiteral(site) ||
      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(site.kind)
    )
      return empty();
    if (ts.isPropertyAccessExpression(site) || ts.isElementAccessExpression(site)) {
      const owner = evaluate(site.expression, next);
      const name = ts.isPropertyAccessExpression(site) ? site.name.text : bindings.constant(site.argumentExpression);
      step('read', site, scope);
      if (name === null) {
        omit('computed-field-open', site);
        return owner;
      }
      const field = owner.fields?.get(name) ?? owner.wildcard ?? owner;
      return { ...field, origins: union([field.origins, owner.origins]) };
    }
    if (ts.isObjectLiteralExpression(site)) {
      const value: Value = { ...empty(), fields: new Map(), fresh: true, allocationFrame: scope.frame };
      for (const property of site.properties) {
        if (ts.isSpreadAssignment(property)) {
          const spread = evaluate(property.expression, next);
          step('spread', property, scope);
          value.presence = union([value.presence, origins(spread, true)]);
          if (!spread.fields) {
            for (const [name, old] of value.fields!) value.fields!.set(name, merge([old, spread]));
            value.wildcard = merge([value.wildcard ?? empty(), spread]);
          } else {
            if (spread.wildcard) {
              for (const [name, old] of value.fields!)
                if (!spread.fields.has(name)) value.fields!.set(name, merge([old, spread.wildcard]));
              value.wildcard = merge([value.wildcard ?? empty(), spread.wildcard]);
            }
            for (const [name, field] of spread.fields) value.fields!.set(name, field);
          }
        } else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          const name = bindings.key(property.name);
          const field = ts.isPropertyAssignment(property)
            ? evaluate(property.initializer, next)
            : lookup(property, next);
          if (name === null) {
            omit('computed-field-open', property);
            continue;
          }
          if (name === '__proto__' && ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
            omit('prototype-construction-open', property);
            continue;
          }
          value.fields!.set(name, field);
          step('write', property, scope);
        } else omit('object-member-effects-open', property);
      }
      return value;
    }
    if (ts.isConditionalExpression(site)) {
      return merge([
        controlled(evaluate(site.whenTrue, split(next, site.condition, 'truthy')), evaluate(site.condition, next)),
        controlled(evaluate(site.whenFalse, split(next, site.condition, 'falsy')), evaluate(site.condition, next)),
      ]);
    }
    if (ts.isBinaryExpression(site)) {
      if (
        site.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        site.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const right = evaluate(site.right, next);
        if (scope.conditions.some((condition) => condition.branch === 'truthy' || condition.branch === 'falsy'))
          omit('conditional-expression-state-open', site);
        if (site.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
          omit('compound-write-open', site);
          return right;
        }
        if (ts.isPropertyAccessExpression(site.left) || ts.isElementAccessExpression(site.left)) {
          const owner = evaluate(site.left.expression, next);
          const name = ts.isPropertyAccessExpression(site.left)
            ? site.left.name.text
            : bindings.constant(site.left.argumentExpression);
          if (!owner.fresh || owner.allocationFrame !== scope.frame || !owner.fields || name === null) {
            omit('caller-visible-or-unknown-write', site);
            return right;
          }
          if (owner === right) {
            omit('cyclic-record-write-open', site);
            return right;
          }
          if (name === '__proto__') {
            omit('prototype-write-open', site);
            return right;
          }
          owner.fields.set(name, right);
        } else if (ts.isIdentifier(site.left)) {
          const declaration = bindings.declaration(site.left);
          if (!declaration) omit('assignment-binding-unresolved', site);
          else {
            if (scope.bindingFrames.get(declaration) !== scope.frame) omit('captured-or-external-binding-write', site);
            scope.env.set(declaration, right);
          }
        } else omit('assignment-target-open', site);
        step('write', site, scope);
        return right;
      }
      if (
        [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(site.operatorToken.kind)
      )
        omit('short-circuit-field-flow-open', site);
      return merge([evaluate(site.left, next), evaluate(site.right, next)]);
    }
    if (ts.isCallExpression(site)) {
      const target = evaluate(site.expression, next).target;
      const arguments_ = site.arguments.map((argument) => evaluate(argument, next));
      const targetPath = target
        ? (sourceRealPath(target.getSourceFile().fileName) ?? resolve(target.getSourceFile().fileName))
        : null;
      const rootPath = sourceRealPath(node.getSourceFile().fileName) ?? resolve(node.getSourceFile().fileName);
      if (
        !target?.body ||
        target.getSourceFile().isDeclarationFile ||
        !targetPath ||
        (targetPath !== rootPath &&
          (!reader.collection.repositoryRoot || !isWithinSourceBoundary(reader.collection.repositoryRoot, targetPath)))
      ) {
        omit('opaque-call-effects-open', site);
        return merge(arguments_);
      }
      if (scope.active.has(target)) {
        omit('recursive-field-call-open', site);
        return merge(arguments_);
      }
      const invocation = {
        ...next,
        env: new Map(scope.env),
        bindingFrames: new Map(scope.bindingFrames),
        active: new Set([...scope.active, target]),
        frame: ++frame,
      };
      step('call', site, invocation);
      target.parameters.forEach((parameter, index) => {
        if (parameter.dotDotDotToken) omit('rest-parameter-open', parameter);
        const argument = arguments_[index] ?? empty();
        bind(
          parameter,
          parameter.initializer ? merge([argument, evaluate(parameter.initializer, invocation)]) : argument,
          invocation,
        );
      });
      const result = execute(target.body, invocation);
      const foreignRecord = (value: Value, seen = new Set<Value>()): boolean => {
        if (seen.has(value)) return false;
        seen.add(value);
        return (
          (value.fresh === true && value.allocationFrame !== invocation.frame) ||
          [...(value.fields?.values() ?? []), ...(value.wildcard ? [value.wildcard] : [])].some((member) =>
            foreignRecord(member, seen),
          )
        );
      };
      if (foreignRecord(result)) omit('cross-frame-record-alias-open', site);
      return result;
    }
    if (
      ts.isPrefixUnaryExpression(site) &&
      ![ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(site.operator)
    )
      return evaluate(site.operand, next);
    if (ts.isTemplateExpression(site)) return merge(site.templateSpans.map((span) => evaluate(span.expression, next)));
    omit('field-expression-effects-open', site);
    return empty();
  }
  function controlled(value: Value, condition: Value): Value {
    return {
      ...value,
      origins: union([value.origins, origins(condition)]),
      presence: union([value.presence, origins(condition, true)]),
    };
  }
  function execute(body: ts.ConciseBody, scope: Scope): Value {
    if (!ts.isBlock(body)) {
      const value = controlled(evaluate(body, scope), { ...empty(), origins: scope.control });
      step('return', body, scope);
      return value;
    }
    const returned: Value[] = [];
    const sequence = (statements: readonly ts.Statement[], scopes: Scope[]): Scope[] => {
      for (const statement of statements) {
        if (!scopes.length) break;
        scopes = scopes.flatMap((current) => visit(statement, current));
      }
      return scopes;
    };
    const visit = (statement: ts.Statement, current: Scope): Scope[] => {
      if (!admit(statement, current.depth)) return [];
      if (ts.isReturnStatement(statement)) {
        const value = statement.expression ? evaluate(statement.expression, current) : empty();
        step('return', statement, current);
        returned.push(copy(controlled(value, { ...empty(), origins: current.control })));
        return [];
      }
      if (ts.isIfStatement(statement))
        return [
          ...visit(statement.thenStatement, split(current, statement.expression, 'then')),
          ...(statement.elseStatement
            ? visit(statement.elseStatement, split(current, statement.expression, 'else'))
            : [split(current, statement.expression, 'else')]),
        ];
      if (ts.isBlock(statement))
        return sequence(statement.statements, [{ ...current, env: new Map(current.env), depth: current.depth + 1 }]);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          bind(declaration, declaration.initializer ? evaluate(declaration.initializer, current) : empty(), current);
        }
      } else if (ts.isExpressionStatement(statement)) evaluate(statement.expression, current);
      else if (ts.isThrowStatement(statement)) {
        omit('exception-field-flow-open', statement);
        return [];
      } else if (!ts.isFunctionDeclaration(statement) && !ts.isEmptyStatement(statement))
        omit('field-statement-effects-open', statement);
      return [current];
    };
    sequence(body.statements, [scope]);
    return merge(returned);
  }
  const initial: Scope = {
    env: new Map(),
    bindingFrames: new Map(),
    control: new Set(),
    conditions: [],
    active: new Set([node]),
    frame: 0,
    depth: 0,
  };
  if (!bindings.scan(node.getSourceFile(), limits.maxNodes)) omit('field-write-scan-bound', node);
  if (node.parameters[0]) {
    const parameter = node.parameters[0];
    const value = sourceValue(reader.checker.getTypeAtLocation(parameter), [], parameter, 0, new Set());
    bind(parameter, parameter.initializer ? merge([value, evaluate(parameter.initializer, initial)]) : value, initial);
  }
  const result = node.body ? execute(node.body, initial) : empty();
  if (!node.body) omit('field-body-unavailable', node);
  function escapingCallable(value: Value, seen = new Set<Value>()): boolean {
    if (seen.has(value)) return false;
    seen.add(value);
    return (
      !!value.target ||
      !!value.opaqueCallable ||
      [...(value.fields?.values() ?? []), ...(value.wildcard ? [value.wildcard] : [])].some((member) =>
        escapingCallable(member, seen),
      )
    );
  }
  if (escapingCallable(result)) omit('callable-escape-open', node);
  const output = origins(result);
  const observablePresence = origins(result, true);
  evidence.proofs = [...subjects].map(([key, path]) => {
    const open = evidence.omissions.map((item) => item.reason);
    const independent = !open.length && !output.has(key);
    const omission = independent && !observablePresence.has(key);
    return {
      inputName: path[0],
      path: path.slice(1).map((key) => ({ kind: 'field' as const, key })),
      valueIndependence: {
        status: independent ? ('conditional' as const) : ('unknown' as const),
        premises: independent ? [...FIELD_VALUE_PREMISES] : [],
        reasons: [...new Set([...open, ...(output.has(key) ? ['possible-output-dependence'] : [])])],
      },
      omissionSafety: {
        status: omission ? ('conditional' as const) : ('unknown' as const),
        premises: omission ? [...FIELD_VALUE_PREMISES, 'entry-delivery-admits-omission'] : [],
        reasons: [
          ...new Set([
            ...open,
            ...(output.has(key) ? ['possible-output-dependence'] : []),
            ...(observablePresence.has(key) ? ['presence-or-order-observable'] : []),
          ]),
        ],
      },
      outputDependence: output.has(key)
        ? ('possible' as const)
        : open.length
          ? ('unknown' as const)
          : ('not-observed' as const),
    };
  });
  evidence.relationalReplay = collectFieldReplay(
    node,
    evidence,
    {
      maxNodes: limits.maxNodes,
      maxDepth: limits.maxDepth,
      maxOperations: limits.maxObservations,
    },
    signal,
  );
  return evidence;
}

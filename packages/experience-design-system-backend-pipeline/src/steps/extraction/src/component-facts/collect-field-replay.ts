import ts from 'typescript';
import { createHash } from 'node:crypto';
import type { SourceFieldSemantics } from '../types/field-semantics.js';
import { SourceValueBindings } from './source-value-bindings.js';
import {
  FIELD_REPLAY_PREMISES,
  FIELD_REPLAY_VERSION,
  fieldReplayIdentity,
  type SourceFieldReplay,
} from '../types/field-replay.js';

type Callable = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
type Value =
  | { kind: 'atom'; term: string }
  | { kind: 'record'; fields: Map<string, Value>; fresh: boolean; frame: number }
  | { kind: 'callable'; target: Callable };
type AtomicValue = Extract<Value, { kind: 'atom' }>;
type Conditions = SourceFieldReplay['operations'][number]['conditions'];
interface Scope {
  env: Map<ts.Declaration | string, Value>;
  conditions: Conditions;
  frame: number;
  active: Set<Callable>;
  readOnly?: boolean;
}
type Completion =
  | { kind: 'continue'; scope: Scope }
  | { kind: 'return'; value: Value }
  | { kind: 'choice'; condition: AtomicValue; truthy: Completion; falsy: Completion };
const atom = (term: unknown): Value => ({ kind: 'atom', term: JSON.stringify(term) });
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const pathOf = (subject: SourceFieldReplay['domain'][number]): string[] => [
  subject.inputName,
  ...subject.path.map((item) => item.key),
];

/** Bounded synchronous alternatives over inert input trees; customer code is never executed. */
export function collectFieldReplay(
  node: Callable,
  semantics: SourceFieldSemantics,
  limits: SourceFieldReplay['limits'],
  signal?: AbortSignal,
  checker?: ts.TypeChecker,
): SourceFieldReplay {
  const replay: Omit<SourceFieldReplay, 'identity'> = {
    schemaVersion: FIELD_REPLAY_VERSION,
    semantics: 'paired-own-data-field-flow',
    status: 'unverified',
    componentDeclarationId: semantics.componentDeclarationId,
    domain: semantics.proofs.map(({ inputName, path }) => ({ inputName, path })),
    observables: 'returned-atom-and-supported-synchronous-effects',
    limits,
    used: { nodes: 0, maxDepth: 0 },
    frames: [],
    operations: [],
    results: [],
  };
  const paths = replay.domain.map(pathOf);
  const parameter = node.parameters[0];
  const operations = new Map<string, SourceFieldReplay['operations'][number]>();
  const frames = new Map<string, number>();
  const bindings = checker ? new SourceValueBindings(checker) : undefined;
  const scanComplete = !bindings || bindings.scan(node.getSourceFile(), limits.maxNodes);
  replay.used.nodes = bindings?.scanNodes ?? 0;

  function run(
    subject: string[],
    mode: 'baseline' | 'variation' | 'omission',
  ): { output: string | null; reasons: string[] } {
    const reasons = new Set<string>();
    const open = (reason: string): Value => {
      reasons.add(reason);
      return atom(['unknown']);
    };
    if (!scanComplete) return { output: null, reasons: ['paired-flow-bound'] };
    if (semantics.coverage !== 'complete-within-declared-bound' || semantics.omissions.length)
      return { output: null, reasons: ['paired-source-coverage-open'] };
    if (signal?.aborted) return { output: null, reasons: ['paired-flow-cancelled'] };
    if (replay.used.nodes >= limits.maxNodes) return { output: null, reasons: ['paired-flow-bound'] };
    const admit = (depth: number): boolean => {
      if (signal?.aborted) {
        reasons.add('paired-flow-cancelled');
        return false;
      }
      if (depth > limits.maxDepth || replay.used.nodes >= limits.maxNodes) {
        reasons.add('paired-flow-bound');
        return false;
      }
      replay.used.nodes++;
      replay.used.maxDepth = Math.max(replay.used.maxDepth, depth);
      return true;
    };
    const step = (
      operation: SourceFieldReplay['operations'][number]['operation'],
      site: ts.Node,
      scope: Scope,
    ): void => {
      const startOffset = site.getStart();
      const key = JSON.stringify([operation, scope.frame, startOffset, site.getEnd(), scope.conditions]);
      if (operations.has(key)) return;
      if (operations.size >= limits.maxOperations) {
        reasons.add('paired-operation-bound');
        return;
      }
      operations.set(key, {
        operation,
        frame: scope.frame,
        startOffset,
        endOffset: site.getEnd(),
        conditions: scope.conditions,
      });
    };
    const root: Value = { kind: 'record', fields: new Map(), fresh: false, frame: 0 };
    for (const path of paths) {
      let parent: Value = root;
      for (let index = 0; index < path.length; index++) {
        if (!admit(index)) break;
        const key = path[index]!;
        if (parent.kind !== 'record') {
          open('paired-domain-conflict');
          break;
        }
        const hasChildren = paths.some(
          (other) =>
            other.length > index + 1 &&
            JSON.stringify(other.slice(0, index + 1)) === JSON.stringify(path.slice(0, index + 1)),
        );
        let value = parent.fields.get(key);
        if (!value) {
          const matches = JSON.stringify(path.slice(0, index + 1)) === JSON.stringify(subject);
          if (matches && mode === 'omission') break;
          value = hasChildren
            ? { kind: 'record', fields: new Map(), fresh: false, frame: 0 }
            : atom([matches && mode === 'variation' ? 'varied-input' : 'input', path.slice(0, index + 1)]);
          parent.fields.set(key, value);
        }
        parent = value;
      }
    }
    const env = new Map<ts.Declaration | string, Value>();
    const initial: Scope = { env, conditions: [], frame: 0, active: new Set([node]) };
    if (
      !parameter ||
      !ts.isIdentifier(parameter.name) ||
      parameter.initializer ||
      parameter.dotDotDotToken ||
      node.parameters.length !== 1
    )
      open('paired-parameter-open');
    else env.set(bindings ? parameter : parameter.name.text, root);
    if (
      paths.some(
        (path) =>
          path.length > subject.length && JSON.stringify(path.slice(0, subject.length)) === JSON.stringify(subject),
      )
    )
      open('paired-record-subject-open');
    if (
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
      ('asteriskToken' in node && node.asteriskToken)
    )
      open('paired-invocation-open');

    function evaluatedKey(site: ts.Expression, depth: number, scope: Scope): string | null {
      const value = evaluate(site, depth + 1, scope);
      if (value.kind !== 'atom') return null;
      const term = JSON.parse(value.term) as unknown[];
      return term[0] === 'literal' && (term[1] === 'string' || term[1] === 'number') ? String(term[2]) : null;
    }
    function keyOf(site: ts.Node | undefined, depth: number, scope: Scope): string | null {
      if (!site) return null;
      if (ts.isComputedPropertyName(site)) return evaluatedKey(site.expression, depth, scope);
      if (ts.isStringLiteralLike(site)) return site.text;
      if (ts.isNumericLiteral(site)) return String(Number(site.text));
      return ts.isIdentifier(site) ? site.text : null;
    }
    function memberKey(
      site: ts.PropertyAccessExpression | ts.ElementAccessExpression,
      depth: number,
      scope: Scope,
    ): string | null {
      return ts.isPropertyAccessExpression(site)
        ? site.name.text
        : site.argumentExpression
          ? evaluatedKey(site.argumentExpression, depth, scope)
          : null;
    }
    function fork(scope: Scope): Scope {
      const memo = new Map<Value, Value>();
      function copy(value: Value): Value {
        if (value.kind !== 'record') return value;
        const cached = memo.get(value);
        if (cached) return cached;
        const result: Value = { kind: 'record', fresh: value.fresh, fields: new Map(), frame: value.frame };
        memo.set(value, result);
        for (const [key, field] of value.fields) result.fields.set(key, copy(field));
        return result;
      }
      return { ...scope, env: new Map([...scope.env].map(([key, value]) => [key, copy(value)])) };
    }
    function condition(value: Value): AtomicValue {
      if (value.kind === 'callable') {
        open('paired-callable-observable-open');
        return { kind: 'atom', term: JSON.stringify(['unknown']) };
      }
      return value.kind === 'atom'
        ? value
        : { kind: 'atom', term: JSON.stringify(['literal', ts.SyntaxKind.TrueKeyword]) };
    }
    function truth(value: AtomicValue): boolean | null {
      const term = JSON.parse(value.term) as unknown[];
      if (term[0] === 'undefined') return false;
      if (term[0] !== 'literal') return null;
      if (term[1] === 'string' || term[1] === 'number') return Boolean(term[2]);
      if (term[1] === ts.SyntaxKind.TrueKeyword) return true;
      if (term[1] === ts.SyntaxKind.FalseKeyword || term[1] === ts.SyntaxKind.NullKeyword) return false;
      return null;
    }
    function alternative(scope: Scope, guard: AtomicValue, site: ts.Expression, branch: 'truthy' | 'falsy'): Scope {
      return {
        ...fork(scope),
        conditions: [
          ...scope.conditions,
          {
            startOffset: site.getStart(),
            endOffset: site.getEnd(),
            branch,
            term: guard.term,
          },
        ],
      };
    }
    function choose(guard: AtomicValue, truthy: AtomicValue, falsy: AtomicValue): AtomicValue {
      if (truthy.term === falsy.term) return truthy;
      return {
        kind: 'atom',
        term: JSON.stringify(['choice', JSON.parse(guard.term), JSON.parse(truthy.term), JSON.parse(falsy.term)]),
      };
    }
    function lookup(site: ts.Identifier | ts.ShorthandPropertyAssignment, scope: Scope): Value {
      const name = ts.isIdentifier(site) ? site.text : site.name.text;
      const declaration = bindings?.declaration(site);
      const value = scope.env.get(bindings ? declaration! : name);
      if (value) {
        if (value.kind === 'callable' && declaration && bindings?.mutated(declaration))
          return open('paired-callable-binding-written');
        return value;
      }
      if (declaration && ts.isFunctionDeclaration(declaration) && !bindings?.mutated(declaration))
        return { kind: 'callable', target: declaration };
      return open('paired-external-binding-open');
    }
    function evaluate(site: ts.Expression, depth: number, scope: Scope): Value {
      if (!admit(Math.max(depth, scope.conditions.length))) return atom(['unknown']);
      if (
        ts.isParenthesizedExpression(site) ||
        ts.isAsExpression(site) ||
        ts.isSatisfiesExpression(site) ||
        ts.isTypeAssertionExpression(site) ||
        ts.isNonNullExpression(site)
      )
        return evaluate(site.expression, depth + 1, scope);
      if (ts.isIdentifier(site)) return lookup(site, scope);
      if (ts.isArrowFunction(site) || ts.isFunctionExpression(site)) return { kind: 'callable', target: site };
      if (ts.isStringLiteralLike(site)) return atom(['literal', 'string', site.text]);
      if (ts.isNumericLiteral(site)) return atom(['literal', 'number', Number(site.text)]);
      if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(site.kind))
        return atom(['literal', site.kind]);
      if (ts.isPropertyAccessExpression(site) || ts.isElementAccessExpression(site)) {
        if (site.questionDotToken) return open('paired-optional-read-open');
        const owner = evaluate(site.expression, depth + 1, scope);
        const key = memberKey(site, depth, scope);
        step('read', site, scope);
        if (owner.kind !== 'record' || key === null) return open('paired-field-read-open');
        return owner.fields.get(key) ?? (owner.fresh ? open('paired-inherited-read-open') : atom(['undefined']));
      }
      if (ts.isObjectLiteralExpression(site)) {
        const value: Value = { kind: 'record', fields: new Map(), fresh: true, frame: scope.frame };
        for (const property of site.properties) {
          if (!admit(depth + 1)) break;
          if (ts.isSpreadAssignment(property)) {
            const spread = evaluate(property.expression, depth + 1, scope);
            step('spread', property, scope);
            if (spread.kind !== 'record') open('paired-spread-open');
            else for (const [name, field] of spread.fields) value.fields.set(name, field);
          } else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            const key = keyOf(property.name, depth, scope);
            if (key === null) {
              open('paired-computed-key-open');
              continue;
            }
            if (key === '__proto__' && ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
              open('paired-prototype-construction-open');
              continue;
            }
            if (ts.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer)
              open('paired-default-open');
            value.fields.set(
              key,
              ts.isPropertyAssignment(property)
                ? evaluate(property.initializer, depth + 1, scope)
                : lookup(property, scope),
            );
            step('write', property, scope);
          } else open('paired-object-effects-open');
        }
        return value;
      }
      if (ts.isConditionalExpression(site)) {
        const guard = condition(evaluate(site.condition, depth + 1, scope));
        step('branch', site.condition, scope);
        const known = truth(guard);
        const branchValue = (branch: 'truthy' | 'falsy') =>
          evaluate(branch === 'truthy' ? site.whenTrue : site.whenFalse, depth + 1, {
            ...alternative(scope, guard, site.condition, branch),
            readOnly: true,
          });
        if (known !== null) return branchValue(known ? 'truthy' : 'falsy');
        const truthy = branchValue('truthy');
        const falsy = branchValue('falsy');
        if (truthy.kind !== 'atom' || falsy.kind !== 'atom') return open('paired-branch-record-value-open');
        return choose(guard, truthy, falsy);
      }
      if (
        ts.isBinaryExpression(site) &&
        site.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (ts.isPropertyAccessExpression(site.left) || ts.isElementAccessExpression(site.left))
      ) {
        if (scope.readOnly) return open('paired-conditional-write-open');
        const owner = evaluate(site.left.expression, depth + 1, scope);
        const key = memberKey(site.left, depth, scope);
        const value = evaluate(site.right, depth + 1, scope);
        if (owner.kind !== 'record' || !owner.fresh || key === null || key === '__proto__')
          return open('paired-write-open');
        // Creating an absent property uses [[Set]] and needs separate inherited setter semantics.
        if (!owner.fields.has(key)) return open('paired-property-creation-open');
        if (owner.frame !== scope.frame) return open('paired-cross-frame-write-open');
        if (value.kind !== 'atom') return open('paired-record-write-open');
        owner.fields.set(key, value);
        step('write', site, scope);
        return value;
      }
      if (ts.isCallExpression(site)) {
        if (
          !bindings ||
          site.questionDotToken ||
          ts.isPropertyAccessExpression(site.expression) ||
          ts.isElementAccessExpression(site.expression) ||
          site.arguments.some(ts.isSpreadElement)
        )
          return open('paired-invocation-open');
        const value = evaluate(site.expression, depth + 1, scope);
        const arguments_ = site.arguments.map((argument) => evaluate(argument, depth + 1, scope));
        if (value.kind !== 'callable') return open('paired-call-target-open');
        const target = value.target;
        if (
          !target.body ||
          target.getSourceFile() !== node.getSourceFile() ||
          target.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
          ('asteriskToken' in target && target.asteriskToken) ||
          target.parameters.some(
            (parameter) => !ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken,
          )
        )
          return open('paired-invocation-open');
        if (scope.active.has(target)) return open('paired-recursive-call-open');
        const key = JSON.stringify([
          scope.frame,
          site.getStart(),
          site.getEnd(),
          target.getStart(),
          target.getEnd(),
          scope.conditions,
        ]);
        let frame = frames.get(key);
        if (frame === undefined) {
          if (frames.size >= limits.maxOperations) return open('paired-frame-bound');
          frame = frames.size + 1;
          frames.set(key, frame);
          replay.frames.push({
            frame,
            parentFrame: scope.frame,
            callStartOffset: site.getStart(),
            callEndOffset: site.getEnd(),
            targetStartOffset: target.getStart(),
            targetEndOffset: target.getEnd(),
          });
        }
        const invocation: Scope = {
          env: new Map(),
          conditions: scope.conditions,
          frame,
          active: new Set([...scope.active, target]),
          readOnly: scope.readOnly,
        };
        target.parameters.forEach((parameter, index) =>
          invocation.env.set(parameter, arguments_[index] ?? atom(['undefined'])),
        );
        step('call', site, invocation);
        if (ts.isBlock(target.body)) return returned(sequence(target.body.statements, invocation, depth + 1));
        const result = evaluate(target.body, depth + 1, invocation);
        step('return', target.body, invocation);
        return returned({ kind: 'return', value: result });
      }
      return open('paired-expression-effects-open');
    }
    function continueWith(completion: Completion, action: (scope: Scope) => Completion): Completion {
      if (completion.kind === 'continue') return action(completion.scope);
      if (completion.kind === 'return') return completion;
      return {
        ...completion,
        truthy: continueWith(completion.truthy, action),
        falsy: continueWith(completion.falsy, action),
      };
    }
    function sequence(statements: readonly ts.Statement[], scope: Scope, depth: number): Completion {
      let completion: Completion = { kind: 'continue', scope };
      for (const statement of statements)
        completion = continueWith(completion, (current) => visit(statement, current, depth));
      return completion;
    }
    function visit(statement: ts.Statement, scope: Scope, depth: number): Completion {
      if (!admit(Math.max(depth, scope.conditions.length))) return { kind: 'return', value: atom(['unknown']) };
      if (ts.isReturnStatement(statement)) {
        const value = statement.expression ? evaluate(statement.expression, depth + 1, scope) : atom(['undefined']);
        step('return', statement, scope);
        return { kind: 'return', value };
      }
      if (ts.isIfStatement(statement)) {
        const guard = condition(evaluate(statement.expression, depth + 1, scope));
        step('branch', statement.expression, scope);
        const known = truth(guard);
        const next = (branch: 'truthy' | 'falsy'): Completion => {
          const child = alternative(scope, guard, statement.expression, branch);
          const body = branch === 'truthy' ? statement.thenStatement : statement.elseStatement;
          return body ? visit(body, child, depth + 1) : { kind: 'continue', scope: child };
        };
        if (known !== null) return next(known ? 'truthy' : 'falsy');
        return { kind: 'choice', condition: guard, truthy: next('truthy'), falsy: next('falsy') };
      }
      if (ts.isBlock(statement)) {
        const original = new Set(scope.env.keys());
        const completion = sequence(statement.statements, scope, depth + 1);
        return continueWith(completion, (current) => {
          for (const key of current.env.keys()) if (!original.has(key)) current.env.delete(key);
          return { kind: 'continue', scope: current };
        });
      }
      if (ts.isVariableStatement(statement)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) open('paired-mutable-binding-open');
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
            open('paired-binding-open');
            continue;
          }
          const binding = bindings ? declaration : declaration.name.text;
          if (scope.env.has(binding)) open('paired-shadowed-binding-open');
          const value = evaluate(declaration.initializer, depth + 1, scope);
          scope.env.set(binding, value);
          step('binding', declaration, scope);
        }
      } else if (ts.isExpressionStatement(statement)) evaluate(statement.expression, depth + 1, scope);
      else if (!ts.isFunctionDeclaration(statement) && !ts.isEmptyStatement(statement))
        open('paired-statement-effects-open');
      return { kind: 'continue', scope };
    }
    function returned(completion: Completion): AtomicValue {
      if (completion.kind === 'continue') return { kind: 'atom', term: JSON.stringify(['undefined']) };
      if (completion.kind === 'return') {
        if (completion.value.kind === 'atom') return completion.value;
        open('paired-record-observables-open');
        return { kind: 'atom', term: JSON.stringify(['unknown']) };
      }
      return choose(completion.condition, returned(completion.truthy), returned(completion.falsy));
    }
    let output: AtomicValue;
    if (!node.body) {
      open('paired-body-unavailable');
      output = { kind: 'atom', term: JSON.stringify(['unknown']) };
    } else if (ts.isBlock(node.body)) output = returned(sequence(node.body.statements, initial, 0));
    else {
      const value = evaluate(node.body, 0, initial);
      step('return', node.body, initial);
      output = returned({ kind: 'return', value });
    }
    return { output: reasons.size ? null : digest(output.term), reasons: [...reasons] };
  }
  for (const subject of replay.domain) {
    const path = pathOf(subject);
    const baseline = run(path, 'baseline');
    const variation = run(path, 'variation');
    const omission = run(path, 'omission');
    const reasons = [...new Set([...baseline.reasons, ...variation.reasons, ...omission.reasons])];
    const makeClaim = (other: typeof baseline, delivery: boolean) => {
      const pairReasons = [...new Set([...baseline.reasons, ...other.reasons])];
      const equal = !pairReasons.length && baseline.output !== null && baseline.output === other.output;
      return {
        status: equal ? ('conditional' as const) : ('unknown' as const),
        premises: equal ? [...FIELD_REPLAY_PREMISES, ...(delivery ? ['entry-delivery-admits-omission'] : [])] : [],
        reasons: equal
          ? []
          : [
              ...pairReasons,
              ...(baseline.output !== null && other.output !== null && baseline.output !== other.output
                ? ['paired-results-differ']
                : []),
            ],
      };
    };
    replay.results.push({
      ...subject,
      valueComparison: { left: baseline.output, right: variation.output },
      omissionComparison: { left: baseline.output, right: omission.output },
      valueIndependence: makeClaim(variation, false),
      omissionSafety: makeClaim(omission, true),
      reasons,
    });
  }
  replay.operations = [...operations.values()];
  return { ...replay, identity: fieldReplayIdentity(replay) };
}

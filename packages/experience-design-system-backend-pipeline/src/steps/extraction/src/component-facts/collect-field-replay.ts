import ts from 'typescript';
import { createHash } from 'node:crypto';
import type { SourceFieldSemantics } from '../types/field-semantics.js';
import { FIELD_REPLAY_PREMISES, fieldReplayIdentity, type SourceFieldReplay } from '../types/field-replay.js';

type Callable = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
type Value = { kind: 'atom'; term: string } | { kind: 'record'; fields: Map<string, Value>; fresh: boolean };
const atom = (term: unknown): Value => ({ kind: 'atom', term: JSON.stringify(term) });
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const pathOf = (subject: SourceFieldReplay['domain'][number]): string[] => [
  subject.inputName,
  ...subject.path.map((item) => item.key),
];

/** This interpreter admits only complete straight-line bodies; it never executes customer code. */
export function collectFieldReplay(
  node: Callable,
  semantics: SourceFieldSemantics,
  limits: SourceFieldReplay['limits'],
  signal?: AbortSignal,
): SourceFieldReplay {
  const replay: Omit<SourceFieldReplay, 'identity'> = {
    schemaVersion: 1,
    semantics: 'paired-own-data-field-flow',
    status: 'unverified',
    componentDeclarationId: semantics.componentDeclarationId,
    domain: semantics.proofs.map(({ inputName, path }) => ({ inputName, path })),
    observables: 'returned-atom-and-supported-synchronous-effects',
    limits,
    used: { nodes: 0, maxDepth: 0 },
    operations: [],
    results: [],
  };
  const paths = replay.domain.map(pathOf);
  const parameter = node.parameters[0];
  const operations = new Map<string, SourceFieldReplay['operations'][number]>();

  function run(
    subject: string[],
    mode: 'baseline' | 'variation' | 'omission',
  ): { output: string | null; reasons: string[] } {
    const reasons = new Set<string>();
    const open = (reason: string): Value => {
      reasons.add(reason);
      return atom(['unknown']);
    };
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
    const step = (operation: SourceFieldReplay['operations'][number]['operation'], site: ts.Node): void => {
      const startOffset = site.getStart();
      const key = JSON.stringify([operation, startOffset, site.getEnd()]);
      if (operations.has(key)) return;
      if (operations.size >= limits.maxOperations) {
        reasons.add('paired-operation-bound');
        return;
      }
      operations.set(key, { operation, frame: 0, startOffset, endOffset: site.getEnd() });
    };
    const root: Value = { kind: 'record', fields: new Map(), fresh: false };
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
            ? { kind: 'record', fields: new Map(), fresh: false }
            : atom([matches && mode === 'variation' ? 'varied-input' : 'input', path.slice(0, index + 1)]);
          parent.fields.set(key, value);
        }
        parent = value;
      }
    }
    const env = new Map<string, Value>();
    if (
      !parameter ||
      !ts.isIdentifier(parameter.name) ||
      parameter.initializer ||
      parameter.dotDotDotToken ||
      node.parameters.length !== 1
    )
      open('paired-parameter-open');
    else env.set(parameter.name.text, root);
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

    function keyOf(site: ts.Node | undefined): string | null {
      if (!site) return null;
      if (ts.isComputedPropertyName(site)) return keyOf(site.expression);
      if (ts.isStringLiteralLike(site) || ts.isNumericLiteral(site)) return site.text;
      return ts.isIdentifier(site) ? site.text : null;
    }
    function memberKey(site: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
      return ts.isPropertyAccessExpression(site)
        ? site.name.text
        : site.argumentExpression &&
            (ts.isStringLiteralLike(site.argumentExpression) || ts.isNumericLiteral(site.argumentExpression))
          ? site.argumentExpression.text
          : null;
    }
    function evaluate(site: ts.Expression, depth: number): Value {
      if (!admit(depth)) return atom(['unknown']);
      if (
        ts.isParenthesizedExpression(site) ||
        ts.isAsExpression(site) ||
        ts.isSatisfiesExpression(site) ||
        ts.isTypeAssertionExpression(site) ||
        ts.isNonNullExpression(site)
      )
        return evaluate(site.expression, depth + 1);
      if (ts.isIdentifier(site)) return env.get(site.text) ?? open('paired-external-binding-open');
      if (ts.isStringLiteralLike(site)) return atom(['literal', 'string', site.text]);
      if (ts.isNumericLiteral(site)) return atom(['literal', 'number', Number(site.text)]);
      if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(site.kind))
        return atom(['literal', site.kind]);
      if (ts.isPropertyAccessExpression(site) || ts.isElementAccessExpression(site)) {
        if (site.questionDotToken) return open('paired-optional-read-open');
        const owner = evaluate(site.expression, depth + 1);
        const key = memberKey(site);
        step('read', site);
        if (owner.kind !== 'record' || key === null) return open('paired-field-read-open');
        return owner.fields.get(key) ?? (owner.fresh ? open('paired-inherited-read-open') : atom(['undefined']));
      }
      if (ts.isObjectLiteralExpression(site)) {
        const value: Value = { kind: 'record', fields: new Map(), fresh: true };
        for (const property of site.properties) {
          if (!admit(depth + 1)) break;
          if (ts.isSpreadAssignment(property)) {
            const spread = evaluate(property.expression, depth + 1);
            step('spread', property);
            if (spread.kind !== 'record') open('paired-spread-open');
            else for (const [name, field] of spread.fields) value.fields.set(name, field);
          } else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            const key = keyOf(property.name);
            if (
              key === null ||
              (ts.isComputedPropertyName(property.name) &&
                !ts.isStringLiteralLike(property.name.expression) &&
                !ts.isNumericLiteral(property.name.expression))
            ) {
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
                ? evaluate(property.initializer, depth + 1)
                : (env.get(property.name.text) ?? open('paired-external-binding-open')),
            );
            step('write', property);
          } else open('paired-object-effects-open');
        }
        return value;
      }
      if (
        ts.isBinaryExpression(site) &&
        site.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (ts.isPropertyAccessExpression(site.left) || ts.isElementAccessExpression(site.left))
      ) {
        const owner = evaluate(site.left.expression, depth + 1);
        const key = memberKey(site.left);
        const value = evaluate(site.right, depth + 1);
        if (owner.kind !== 'record' || !owner.fresh || key === null || key === '__proto__')
          return open('paired-write-open');
        // Creating an absent property uses [[Set]] and needs separate inherited setter semantics.
        if (!owner.fields.has(key)) return open('paired-property-creation-open');
        if (value.kind === 'record') return open('paired-record-write-open');
        owner.fields.set(key, value);
        step('write', site);
        return value;
      }
      return open('paired-expression-effects-open');
    }
    let output: Value = atom(['undefined']);
    if (!node.body) open('paired-body-unavailable');
    else if (!ts.isBlock(node.body)) {
      output = evaluate(node.body, 0);
      step('return', node.body);
    } else {
      for (const statement of node.body.statements) {
        if (!admit(0)) break;
        if (ts.isReturnStatement(statement)) {
          output = statement.expression ? evaluate(statement.expression, 1) : atom(['undefined']);
          step('return', statement);
          break;
        }
        if (ts.isVariableStatement(statement)) {
          if (!(statement.declarationList.flags & ts.NodeFlags.Const)) open('paired-mutable-binding-open');
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
              open('paired-binding-open');
              continue;
            }
            if (env.has(declaration.name.text)) open('paired-shadowed-binding-open');
            const value = evaluate(declaration.initializer, 1);
            env.set(declaration.name.text, value);
            step('binding', declaration);
          }
        } else if (ts.isExpressionStatement(statement)) evaluate(statement.expression, 1);
        else if (!ts.isEmptyStatement(statement)) open('paired-statement-effects-open');
      }
    }
    if (output.kind === 'record') open('paired-record-observables-open');
    return { output: reasons.size || output.kind !== 'atom' ? null : digest(output.term), reasons: [...reasons] };
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

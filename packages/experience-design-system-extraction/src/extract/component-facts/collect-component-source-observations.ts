import type { Node as MorphNode } from 'ts-morph';
import ts from 'typescript';
import type {
  ComponentObservationLimits,
  ComponentSourceObservation,
  ComponentSourceObservationCollection,
  SourceObservationContext,
  SourceObservationOperand,
} from '../types/component-source-observations.js';
import { SourceObservationReader, isWithinSourceBoundary, sourceRealPath } from './source-observation-reader.js';
import { SourceInputPaths } from './source-input-path.js';
import { resolve } from 'node:path';
import { collectInputOutput } from './collect-input-output.js';

export const DEFAULT_COMPONENT_OBSERVATION_LIMITS: Readonly<ComponentObservationLimits> = Object.freeze({
  maxNodes: 4096,
  maxDepth: 64,
  maxReferences: 2048,
  maxDeclarations: 512,
  maxSignatures: 128,
  maxObservations: 1024,
  maxManifestReads: 256,
});
export interface ComponentSourceObservationOptions {
  selectedSourcePaths?: readonly string[];
  repositoryRoot?: string;
  limits?: Partial<ComponentObservationLimits>;
  signal?: AbortSignal;
  closureMaxIterations?: number;
  componentBindings?: readonly MorphNode[];
}
function isCallable(
  node: ts.Node,
): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}
function resultUse(
  node: ts.Node,
  reader: SourceObservationReader,
): NonNullable<ComponentSourceObservation['resultUse']> {
  let useSite = node;
  let parent = node.parent;
  while (parent && ts.isParenthesizedExpression(parent)) {
    useSite = parent;
    parent = parent.parent;
  }
  const kind = !parent
    ? 'expression'
    : ts.isExpressionStatement(parent)
      ? 'discarded'
      : ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === useSite)
        ? 'returned'
        : ts.isCallExpression(parent) || ts.isNewExpression(parent)
          ? parent.expression === useSite
            ? 'expression'
            : 'argument'
          : ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)
            ? 'initializer'
            : ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)
              ? 'member'
              : ts.isIfStatement(parent) || ts.isConditionalExpression(parent) || ts.isWhileStatement(parent)
                ? 'condition'
                : ts.isBinaryExpression(parent) &&
                    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
                    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
                  ? 'assigned'
                  : 'expression';
  return { kind, parentKind: ts.SyntaxKind[(parent ?? node).kind], location: reader.location(parent ?? node) };
}

/** Observe syntax/type/symbol evidence; collection never makes authoring decisions. */
export function collectComponentSourceObservations(
  component: MorphNode,
  options: ComponentSourceObservationOptions = {},
): ComponentSourceObservationCollection {
  const node = component.compilerNode;
  const limits = { ...DEFAULT_COMPONENT_OBSERVATION_LIMITS };
  for (const key of Object.keys(limits) as Array<keyof ComponentObservationLimits>) {
    const value = options.limits?.[key];
    if (value !== undefined && Number.isFinite(value) && value >= 0) limits[key] = Math.floor(value);
  }
  const collection: ComponentSourceObservationCollection = {
    schemaVersion: 1,
    componentDeclarationId: '',
    selectedSourcePaths: [
      ...new Set((options.selectedSourcePaths ?? []).map((path) => sourceRealPath(resolve(path)) ?? resolve(path))),
    ].sort(),
    repositoryRoot: options.repositoryRoot
      ? (sourceRealPath(resolve(options.repositoryRoot)) ?? resolve(options.repositoryRoot))
      : null,
    observations: [],
    coverage: 'complete-within-declared-bound',
    limits,
    used: {
      maxNodes: 0,
      maxDepth: 0,
      maxReferences: 0,
      maxDeclarations: 0,
      maxSignatures: 0,
      maxObservations: 0,
      maxManifestReads: 0,
    },
    omissions: [],
  };
  const project = component.getProject();
  const reader = new SourceObservationReader(
    project.getTypeChecker().compilerObject,
    project.getProgram().compilerObject,
    collection,
  );
  collection.componentDeclarationId = reader.identity(node);
  if (!isCallable(node)) {
    collection.coverage = 'unavailable';
    reader.omit('component-declaration-unsupported', node);
    collection.coverage = 'unavailable';
    return collection;
  }
  const paths = new SourceInputPaths(reader, node.parameters);
  const bodyQueue: Array<{ node: ts.Node; context: SourceObservationContext; depth: number }> = [];
  const visitedBodies = new Set<ts.Node>([node]);
  const visitedSites = new Set<string>();
  const initialContext: SourceObservationContext = {
    lexicalDeclaration: reader.location(node),
    execution: 'component-body',
    conditions: [],
  };
  function operand(
    value: ts.Node,
    role: SourceObservationOperand['role'],
    index: number | null = null,
  ): SourceObservationOperand {
    const symbolNode =
      ts.isIdentifier(value) || ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value);
    return {
      role,
      index,
      expression: value.getText(),
      location: reader.location(value),
      symbol: symbolNode ? reader.symbol(value) : null,
      inputPath: paths.path(value),
    };
  }
  function emit(
    kind: ComponentSourceObservation['kind'],
    site: ts.Node,
    context: SourceObservationContext,
    extra: Partial<ComponentSourceObservation> = {},
  ): void {
    const id = extra.id ?? `${reader.identity(site)}:${kind}`;
    if (visitedSites.has(id) || !reader.admit('maxObservations', site)) return;
    visitedSites.add(id);
    const inputPath = paths.path(site);
    const segments = inputPath?.segments;
    const exact =
      inputPath?.parameterIndex === 0 &&
      segments?.length &&
      segments.every((segment) => segment.kind === 'field' || segment.kind === 'index');
    collection.observations.push({
      id,
      kind,
      expression: site.getText(),
      location: reader.location(site),
      certainty: 'certain',
      context,
      subject: null,
      inputPath,
      ...(exact
        ? {
            candidateKeyPath: segments.map((segment) =>
              segment.kind === 'field' ? segment.name : segment.kind === 'index' ? segment.value : '',
            ),
          }
        : {}),
      ...extra,
    });
  }
  function condition(
    context: SourceObservationContext,
    expression: ts.Node,
    branch: SourceObservationContext['conditions'][number]['branch'],
  ): SourceObservationContext {
    return {
      ...context,
      conditions: [
        ...context.conditions,
        { expression: expression.getText(), branch, location: reader.location(expression) },
      ],
    };
  }
  function calleeAlternatives(expression: ts.Expression, depth = 0): ts.Expression[] {
    if (depth > limits.maxDepth) {
      reader.omit('maxDepth-limit', expression);
      return [expression];
    }
    if (ts.isParenthesizedExpression(expression)) return calleeAlternatives(expression.expression, depth + 1);
    if (ts.isConditionalExpression(expression))
      return [
        ...calleeAlternatives(expression.whenTrue, depth + 1),
        ...calleeAlternatives(expression.whenFalse, depth + 1),
      ];
    if (
      ts.isBinaryExpression(expression) &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(
        expression.operatorToken.kind,
      )
    )
      return [...calleeAlternatives(expression.left, depth + 1), ...calleeAlternatives(expression.right, depth + 1)];
    return [expression];
  }
  function enqueueReferenced(callee: ts.Node, depth: number): void {
    const symbol = reader.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(callee) ? callee.name : callee);
    for (const declaration of reader.declarations(symbol, callee)) {
      const callable = isCallable(declaration)
        ? declaration
        : ts.isVariableDeclaration(declaration) && declaration.initializer && isCallable(declaration.initializer)
          ? declaration.initializer
          : null;
      if (!callable?.body || callable.getSourceFile().isDeclarationFile || visitedBodies.has(callable)) continue;
      visitedBodies.add(callable);
      const path = sourceRealPath(callable.getSourceFile().fileName) ?? resolve(callable.getSourceFile().fileName);
      const inScope =
        path === (sourceRealPath(node.getSourceFile().fileName) ?? resolve(node.getSourceFile().fileName)) ||
        (collection.repositoryRoot && isWithinSourceBoundary(collection.repositoryRoot, path));
      if (!inScope) {
        reader.omit('referenced-body-outside-boundary', callable);
        continue;
      }
      bodyQueue.push({
        node: callable,
        context: {
          lexicalDeclaration: reader.location(callable),
          execution: 'referenced-body',
          conditions: [],
        },
        depth: depth + 1,
      });
    }
  }
  function visit(site: ts.Node, context: SourceObservationContext, depth: number): void {
    if (options.signal?.aborted) {
      reader.omit('collection-cancelled', site);
      return;
    }
    if (depth > limits.maxDepth) {
      reader.omit('maxDepth-limit', site);
      return;
    }
    if (!reader.admit('maxNodes', site)) return;
    collection.used.maxDepth = Math.max(collection.used.maxDepth, depth);
    const lexical = isCallable(site)
      ? {
          ...context,
          lexicalDeclaration: reader.location(site),
          execution:
            site === node
              ? ('component-body' as const)
              : context.execution === 'referenced-body' && context.lexicalDeclaration?.startOffset === site.getStart()
                ? ('referenced-body' as const)
                : ('deferred' as const),
        }
      : context;
    if (isCallable(site)) {
      const name = site.name ?? (ts.isVariableDeclaration(site.parent) ? site.parent.name : site);
      emit('declaration', site, lexical, { subject: reader.symbol(name), type: reader.type(site) });
      for (const doc of ts.getJSDocCommentsAndTags(site)) emit('annotation', doc, lexical);
      const source = site.getSourceFile();
      const comments = [
        ...(ts.getLeadingCommentRanges(source.text, site.pos) ?? []),
        ...(ts.getTrailingCommentRanges(source.text, site.pos) ?? []),
      ];
      for (const comment of comments) {
        const expression = source.text.slice(comment.pos, comment.end);
        if (!expression.startsWith('/**')) continue;
        const location = reader.range(source, comment.pos, comment.end);
        emit('annotation', site, lexical, {
          id: `${location.canonicalPath}:${location.textHash}:${comment.pos}:${comment.end}:annotation`,
          expression,
          location,
        });
      }
    }
    if (ts.isVariableDeclaration(site) || ts.isBindingElement(site) || ts.isParameter(site)) {
      emit('binding', site, lexical, {
        subject: reader.symbol(site.name),
        inputPath: paths.declaration(site),
        initializer: site.initializer?.getText() ?? null,
        type: reader.type(site),
      });
    }
    if (ts.isCallExpression(site) || ts.isNewExpression(site)) {
      emit('call', site, lexical, {
        subject: reader.symbol(site.expression),
        operands: [
          ...calleeAlternatives(site.expression).map((alternative) => operand(alternative, 'callee')),
          ...(site.arguments ?? []).map((arg, index) => operand(arg, 'argument', index)),
        ],
        type: reader.callType(site),
        resultUse: resultUse(site, reader),
      });
      for (const alternative of calleeAlternatives(site.expression)) enqueueReferenced(alternative, depth);
    }
    if (ts.isReturnStatement(site))
      emit('return', site, lexical, { operands: site.expression ? [operand(site.expression, 'value')] : [] });
    if (ts.isPropertyAccessExpression(site) || ts.isElementAccessExpression(site))
      emit('member-read', site, lexical, {
        subject: reader.symbol(site),
        type: reader.type(site),
        operands: [operand(site.expression, 'owner')],
      });
    if (ts.isBinaryExpression(site)) {
      const operator = site.operatorToken.getText();
      if (
        site.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        site.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        paths.recordAssignment(site.left);
        emit('assignment', site, lexical, {
          operator,
          operands: [operand(site.left, 'target'), operand(site.right, 'value')],
        });
      }
      if (
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.LessThanToken,
          ts.SyntaxKind.LessThanEqualsToken,
          ts.SyntaxKind.GreaterThanToken,
          ts.SyntaxKind.GreaterThanEqualsToken,
          ts.SyntaxKind.InKeyword,
          ts.SyntaxKind.InstanceOfKeyword,
        ].includes(site.operatorToken.kind)
      )
        emit('comparison', site, lexical, {
          operator,
          operands: [operand(site.left, 'left'), operand(site.right, 'right')],
        });
    }
    if (
      (ts.isPrefixUnaryExpression(site) || ts.isPostfixUnaryExpression(site)) &&
      (site.operator === ts.SyntaxKind.PlusPlusToken || site.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      paths.recordAssignment(site.operand);
      emit('assignment', site, lexical, {
        operator: ts.tokenToString(site.operator),
        operands: [operand(site.operand, 'target')],
      });
    }
    if (ts.isThrowStatement(site)) emit('throw', site, lexical, { operands: [operand(site.expression, 'value')] });
    if (
      ts.isAsExpression(site) ||
      ts.isTypeAssertionExpression(site) ||
      ts.isNonNullExpression(site) ||
      ts.isSatisfiesExpression(site)
    )
      emit('assertion', site, lexical, { type: reader.type(site), operands: [operand(site.expression, 'value')] });
    if (ts.isJsxOpeningElement(site) || ts.isJsxSelfClosingElement(site)) {
      emit('jsx', site, lexical, { subject: reader.symbol(site.tagName), operands: [operand(site.tagName, 'target')] });
      enqueueReferenced(site.tagName, depth);
    }
    if (ts.isJsxAttribute(site))
      emit('jsx-attribute', site, lexical, {
        destination: {
          kind: site.name.getText() === 'ref' ? 'reference' : 'markup-attribute',
          name: site.name.getText(),
        },
        operands:
          site.initializer && ts.isJsxExpression(site.initializer) && site.initializer.expression
            ? [operand(site.initializer.expression, 'value')]
            : [],
      });
    if (ts.isSpreadAssignment(site) || ts.isSpreadElement(site) || ts.isJsxSpreadAttribute(site))
      emit('spread', site, lexical, { operands: [operand(site.expression, 'value')] });
    if (ts.isIfStatement(site) || ts.isConditionalExpression(site)) {
      const expression = ts.isIfStatement(site) ? site.expression : site.condition;
      emit('condition', expression, lexical, { operands: [operand(expression, 'condition')] });
      visit(expression, lexical, depth + 1);
      if (ts.isIfStatement(site)) {
        visit(site.thenStatement, condition(lexical, expression, 'then'), depth + 1);
        if (site.elseStatement) visit(site.elseStatement, condition(lexical, expression, 'else'), depth + 1);
      } else {
        visit(site.whenTrue, condition(lexical, expression, 'truthy'), depth + 1);
        visit(site.whenFalse, condition(lexical, expression, 'falsy'), depth + 1);
      }
      return;
    }
    if (ts.isWhileStatement(site) || ts.isDoStatement(site) || ts.isForStatement(site)) {
      const expression = ts.isForStatement(site) ? site.condition : site.expression;
      if (ts.isForStatement(site) && site.initializer) visit(site.initializer, lexical, depth + 1);
      if (expression) {
        emit('condition', expression, lexical, { operands: [operand(expression, 'condition')] });
        visit(expression, lexical, depth + 1);
      }
      const bodyContext = expression ? condition(lexical, expression, 'body') : lexical;
      visit(site.statement, bodyContext, depth + 1);
      if (ts.isForStatement(site) && site.incrementor) visit(site.incrementor, bodyContext, depth + 1);
      return;
    }
    if (ts.isSwitchStatement(site)) {
      emit('condition', site.expression, lexical, { operands: [operand(site.expression, 'condition')] });
      visit(site.expression, lexical, depth + 1);
      for (const clause of site.caseBlock.clauses) {
        if (collection.used.maxNodes >= limits.maxNodes) {
          reader.omit('maxNodes-limit', clause);
          break;
        }
        const caseContext = ts.isCaseClause(clause) ? condition(lexical, clause.expression, 'case') : lexical;
        visit(clause, caseContext, depth + 1);
      }
      return;
    }
    if (
      ts.isBinaryExpression(site) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
        site.operatorToken.kind,
      )
    ) {
      emit('condition', site.left, lexical, {
        operator: site.operatorToken.getText(),
        operands: [operand(site.left, 'condition')],
      });
      visit(site.left, lexical, depth + 1);
      visit(
        site.right,
        condition(
          lexical,
          site.left,
          site.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
            ? 'truthy'
            : site.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
              ? 'nullish'
              : 'falsy',
        ),
        depth + 1,
      );
      return;
    }
    ts.forEachChild(site, (child) => {
      if (collection.used.maxNodes >= limits.maxNodes) {
        reader.omit('maxNodes-limit', child);
        return true;
      }
      visit(child, lexical, depth + 1);
      return undefined;
    });
  }
  visit(node, initialContext, 0);
  // Only top-level expression statements that refer to this component belong to its sidecar.
  const owner = ts.isVariableDeclaration(node.parent) ? node.parent : node;
  const owners = [owner, ...(options.componentBindings ?? []).map((binding) => binding.compilerNode)];
  const ownerSymbols = new Set(
    owners.flatMap((binding) => {
      const name = 'name' in binding ? (binding.name as ts.Node | undefined) : undefined;
      const symbol = name ? reader.checker.getSymbolAtLocation(name) : undefined;
      return symbol ? [symbol] : [];
    }),
  );
  function refersToOwner(site: ts.Node, depth: number): boolean {
    if (depth > limits.maxDepth) {
      reader.omit('maxDepth-limit', site);
      return false;
    }
    if (!reader.admit('maxNodes', site)) return false;
    collection.used.maxDepth = Math.max(collection.used.maxDepth, depth);
    if (ts.isIdentifier(site) && ownerSymbols.has(reader.checker.getSymbolAtLocation(site)!)) return true;
    let found = false;
    ts.forEachChild(site, (child) => {
      if (found) return true;
      if (collection.used.maxNodes >= limits.maxNodes) {
        reader.omit('maxNodes-limit', child);
        return true;
      }
      found = refersToOwner(child, depth + 1);
      return undefined;
    });
    return found;
  }
  for (const statement of node.getSourceFile().statements) {
    if (collection.used.maxNodes >= limits.maxNodes) {
      reader.omit('maxNodes-limit', statement);
      break;
    }
    if (ts.isExpressionStatement(statement) && refersToOwner(statement.expression, 0))
      visit(statement, { lexicalDeclaration: null, execution: 'source-file', conditions: [] }, 0);
  }
  for (let index = 0; index < bodyQueue.length; index += 1) {
    const item = bodyQueue[index]!;
    if (collection.used.maxNodes >= limits.maxNodes) {
      reader.omit('maxNodes-limit', item.node);
      break;
    }
    visit(item.node, item.context, item.depth);
  }
  collection.observations = collection.observations.map((observation) => ({
    ...observation,
    ...(observation.inputPath !== undefined ? { inputPath: paths.qualify(observation.inputPath) } : {}),
    ...(observation.operands
      ? {
          operands: observation.operands.map((operand) => ({
            ...operand,
            inputPath: paths.qualify(operand.inputPath),
          })),
        }
      : {}),
  }));
  collection.observations.sort(
    (a, b) =>
      (a.location.canonicalPath ?? '').localeCompare(b.location.canonicalPath ?? '') ||
      (a.location.startOffset ?? 0) - (b.location.startOffset ?? 0) ||
      a.kind.localeCompare(b.kind),
  );
  collection.omissions.sort(
    (a, b) =>
      (a.location?.canonicalPath ?? '').localeCompare(b.location?.canonicalPath ?? '') ||
      (a.location?.startOffset ?? 0) - (b.location?.startOffset ?? 0) ||
      a.reason.localeCompare(b.reason),
  );
  collection.inputOutput = collectInputOutput(node, reader, options.signal);
  return collection;
}

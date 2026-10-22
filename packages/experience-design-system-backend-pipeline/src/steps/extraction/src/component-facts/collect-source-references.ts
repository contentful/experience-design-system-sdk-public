import ts from 'typescript';
import type { SourceCallerValue, SourceCompilerReference, SourceReferenceIndex } from '../types/source-references.js';
import { isWithinSourceBoundary, SourceObservationReader } from './source-observation-reader.js';
import { SourceValueBindings } from './source-value-bindings.js';

type Conditions = SourceCompilerReference['conditions'];
type Target = SourceCompilerReference['targets'][number];
function callable(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}
function unwrap(node: ts.Node): ts.Node {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}

/** Index lexical sightings in the producer's configured program; no execution or domain inference. */
export function collectSourceReferences(
  component: ts.FunctionLikeDeclaration,
  reader: SourceObservationReader,
  bindings: readonly ts.Node[],
  signal?: AbortSignal,
): SourceReferenceIndex {
  const values = new SourceValueBindings(reader.checker);
  const index: SourceReferenceIndex = {
    schemaVersion: 1,
    semantics: 'lexical-reference-observations',
    componentDeclarationId: reader.identity(component),
    declaration: reader.location(component),
    files: [],
    references: [],
    summaries: [],
    coverage: 'partial',
    limits: {
      maxNodes: reader.collection.limits.maxNodes,
      maxReferences: reader.collection.limits.maxReferences,
      maxFiles: 256,
      maxDepth: reader.collection.limits.maxDepth,
    },
    used: { nodes: 0, references: 0, files: 0, depth: 0 },
    omissions: [],
  };
  const omit = (reason: string, node?: ts.Node) => {
    const location = node ? reader.location(node) : null;
    const found = index.omissions.find(
      (item) =>
        item.reason === reason &&
        item.location?.canonicalPath === location?.canonicalPath &&
        item.location?.startOffset === location?.startOffset,
    );
    if (found) found.count += 1;
    else index.omissions.push({ reason, location, count: 1 });
  };
  const componentOwners = new Set<ts.Node>([component, ...bindings]);
  if (ts.isVariableDeclaration(component.parent)) componentOwners.add(component.parent);
  const selected = new Set(reader.collection.selectedSourcePaths);
  const files = reader.program
    .getSourceFiles()
    .filter(
      (file) =>
        !reader.program.isSourceFileDefaultLibrary(file) &&
        (!reader.collection.repositoryRoot ||
          isWithinSourceBoundary(reader.collection.repositoryRoot, reader.location(file).canonicalPath!)),
    )
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  if (files.length > index.limits.maxFiles) omit('max-reference-files');
  let mutationComplete = files.length <= index.limits.maxFiles;
  for (const file of files.slice(0, index.limits.maxFiles)) {
    if ((file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length)
      omit('reference-source-parse-error', file);
    if (!values.scan(file, index.limits.maxNodes - values.scanNodes)) {
      mutationComplete = false;
      omit('mutation-scan-budget', file);
      break;
    }
  }
  index.used.nodes = values.scanNodes;
  const inputType = component.parameters[0] ? reader.checker.getTypeAtLocation(component.parameters[0]) : null;
  const declared = new Map(inputType?.getProperties().map((symbol) => [symbol.name, symbol]) ?? []);
  const condition = (items: Conditions, node: ts.Node, branch: Conditions[number]['branch']): Conditions => [
    ...items,
    { expression: node.getText(), branch, location: reader.location(node) },
  ];
  const resolveTargets = (
    site: ts.Node,
    guards: Conditions = [],
    seen = new Set<ts.Node>(),
    reasons: string[] = [],
  ): Target[] => {
    const node = unwrap(site);
    if (seen.has(node) || seen.size >= index.limits.maxDepth) {
      reasons.push(seen.has(node) ? 'target-cycle' : 'target-depth-budget');
      return [];
    }
    seen.add(node);
    if (componentOwners.has(node))
      return [{ declarationId: index.componentDeclarationId, location: index.declaration, conditions: guards }];
    if (callable(node))
      return [{ declarationId: reader.identity(node), location: reader.location(node), conditions: guards }];
    if (ts.isConditionalExpression(node))
      return [
        ...resolveTargets(node.whenTrue, condition(guards, node.condition, 'truthy'), new Set(seen), reasons),
        ...resolveTargets(node.whenFalse, condition(guards, node.condition, 'falsy'), new Set(seen), reasons),
      ];
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(
        node.operatorToken.kind,
      )
    ) {
      const op = node.operatorToken.kind;
      return [
        ...resolveTargets(
          node.left,
          condition(
            guards,
            node.left,
            op === ts.SyntaxKind.QuestionQuestionToken
              ? 'non-nullish'
              : op === ts.SyntaxKind.AmpersandAmpersandToken
                ? 'falsy'
                : 'truthy',
          ),
          new Set(seen),
          reasons,
        ),
        ...resolveTargets(
          node.right,
          condition(
            guards,
            node.left,
            op === ts.SyntaxKind.AmpersandAmpersandToken
              ? 'truthy'
              : op === ts.SyntaxKind.QuestionQuestionToken
                ? 'nullish'
                : 'falsy',
          ),
          new Set(seen),
          reasons,
        ),
      ];
    }
    let symbol = ts.isShorthandPropertyAssignment(node)
      ? reader.checker.getShorthandAssignmentValueSymbol(node)
      : reader.checker.getSymbolAtLocation(node);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = reader.checker.getAliasedSymbol(symbol);
    const declarations = symbol?.declarations ?? [];
    const targets: Target[] = [];
    for (const declaration of declarations) {
      if (componentOwners.has(declaration))
        targets.push({ declarationId: index.componentDeclarationId, location: index.declaration, conditions: guards });
      else if (callable(declaration))
        targets.push({
          declarationId: reader.identity(declaration),
          location: reader.location(declaration),
          conditions: guards,
        });
      else if (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) {
        const initializer = declaration.initializer;
        if (initializer) {
          if (
            values.mutated(declaration) ||
            (ts.isVariableDeclaration(declaration) && !(declaration.parent.flags & ts.NodeFlags.Const))
          )
            reasons.push('target-mutation-or-mutable-binding');
          targets.push(...resolveTargets(initializer, guards, new Set(seen), reasons));
        }
      } else if (ts.isShorthandPropertyAssignment(declaration))
        targets.push(...resolveTargets(declaration.name, guards, new Set(seen), reasons));
    }
    if (!targets.length && (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node))) {
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression
          ? values.constant(node.argumentExpression)
          : null;
      const baseDeclaration = values.declaration(node.expression);
      if (key !== null && baseDeclaration && ts.isVariableDeclaration(baseDeclaration) && baseDeclaration.initializer) {
        const object = unwrap(baseDeclaration.initializer);
        if (ts.isObjectLiteralExpression(object)) {
          if (values.mutated(baseDeclaration)) reasons.push('target-base-mutated');
          for (const property of object.properties)
            if (ts.isPropertyAssignment(property) && values.key(property.name) === key)
              targets.push(...resolveTargets(property.initializer, guards, new Set(seen), reasons));
        }
      } else if (key === null) reasons.push('dynamic-target-key');
    }
    if (!targets.length) reasons.push(symbol ? 'target-unsupported-or-no-body' : 'target-unresolved');
    if (!mutationComplete) reasons.push('target-mutation-scan-incomplete');
    return targets;
  };
  const knownComponents = (node: ts.Node): SourceCallerValue['components'] => {
    if (ts.isJsxElement(node)) node = node.openingElement;
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return [];
    const symbol = reader.symbol(node.tagName);
    return (
      symbol?.declarations.map((declaration) => ({ declarationId: declaration.id, location: declaration.location })) ??
      []
    );
  };
  const readValue = (
    site: ts.Node,
    name: string,
    parameterIndex: number | null = null,
    seen = new Set<ts.Node>(),
  ): SourceCallerValue => {
    const node = unwrap(site);
    const value: SourceCallerValue = {
      name,
      parameterIndex,
      state: 'unknown',
      origin: 'unknown',
      representation: 'expression',
      expression: site.getText(),
      location: reader.location(site),
      valueLocation: null,
      components: [],
      reasons: [],
      parts: [],
    };
    if (seen.has(node) || seen.size >= index.limits.maxDepth) return { ...value, reasons: ['value-cycle-or-depth'] };
    seen.add(node);
    let literal: string | number | boolean | null | undefined;
    if (ts.isStringLiteralLike(node)) literal = node.text;
    else if (ts.isNumericLiteral(node)) literal = Number(node.text);
    else if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword)
      literal = node.kind === ts.SyntaxKind.TrueKeyword;
    else if (node.kind === ts.SyntaxKind.NullKeyword) literal = null;
    else if (
      ts.isPrefixUnaryExpression(node) &&
      ts.isNumericLiteral(node.operand) &&
      [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operator)
    )
      literal = Number(node.operand.text) * (node.operator === ts.SyntaxKind.MinusToken ? -1 : 1);
    if (literal !== undefined) {
      if (
        typeof literal === 'number' &&
        (!Number.isFinite(literal) || (Number.isInteger(literal) && !Number.isSafeInteger(literal)))
      )
        return { ...value, reasons: ['unsafe-literal-number'] };
      return {
        ...value,
        state: 'provided',
        origin: 'fixed',
        representation: 'literal',
        value: literal,
        valueLocation: reader.location(node),
      };
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
      return { ...value, state: 'provided', origin: 'fixed', representation: 'jsx', components: knownComponents(node) };
    if (callable(node)) return { ...value, state: 'provided', origin: 'fixed', representation: 'callback' };
    const declaration = values.declaration(node);
    if (declaration && !mutationComplete) return { ...value, reasons: ['mutation-scan-incomplete'] };
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      let baseNode: ts.Node = node.expression;
      for (;;) {
        const base = values.declaration(baseNode);
        if (base && values.mutated(base)) return { ...value, reasons: ['value-base-mutated'] };
        baseNode = unwrap(baseNode);
        if (!ts.isPropertyAccessExpression(baseNode) && !ts.isElementAccessExpression(baseNode)) break;
        baseNode = baseNode.expression;
      }
    }
    if (declaration && values.mutated(declaration)) return { ...value, reasons: ['value-mutated'] };
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      declaration.parent.flags & ts.NodeFlags.Const
    )
      return {
        ...readValue(declaration.initializer, name, parameterIndex, seen),
        expression: site.getText(),
        location: reader.location(site),
      };
    if (declaration && ts.isPropertyAssignment(declaration))
      return {
        ...readValue(declaration.initializer, name, parameterIndex, seen),
        expression: site.getText(),
        location: reader.location(site),
      };
    if (declaration && (ts.isParameter(declaration) || ts.isBindingElement(declaration)))
      return { ...value, state: 'provided', origin: 'forwarded', reasons: ['caller-value-open'] };
    return { ...value, reasons: [declaration ? 'value-unsupported' : 'value-unresolved'] };
  };
  const empty = (name: string, site: ts.Node, unknown: boolean): SourceCallerValue => ({
    name,
    parameterIndex: null,
    state: unknown ? 'unknown' : 'omitted',
    origin: 'unknown',
    representation: 'expression',
    expression: null,
    location: reader.location(site),
    valueLocation: null,
    components: [],
    reasons: unknown ? ['unknown-spread-may-provide'] : [],
    parts: [],
  });
  function readInputs(site: ts.JsxOpeningElement | ts.JsxSelfClosingElement | ts.CallExpression): {
    inputs: SourceCallerValue[];
    history: SourceCallerValue[];
  } {
    const properties = new Map<string, SourceCallerValue>();
    const history: SourceCallerValue[] = [];
    let unknownSpread = false;
    const set = (name: string, node: ts.Node, value?: SourceCallerValue) => {
      const item = value ?? readValue(node, name);
      properties.set(name, item);
      history.push(item);
    };
    const spread = (source: ts.Expression, seen = new Set<ts.Node>()) => {
      const node = unwrap(source);
      if (!seen.has(node) && seen.size < index.limits.maxDepth) {
        seen.add(node);
        const declaration = values.declaration(node);
        if (
          declaration &&
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer &&
          declaration.parent.flags & ts.NodeFlags.Const &&
          mutationComplete &&
          !values.mutated(declaration)
        )
          return spread(declaration.initializer, seen);
        if (ts.isObjectLiteralExpression(node)) {
          for (const property of node.properties) {
            if (ts.isSpreadAssignment(property)) spread(property.expression, new Set(seen));
            else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
              const key = values.key(property.name);
              if (key !== null) set(key, ts.isPropertyAssignment(property) ? property.initializer : property.name);
              else weaken(property);
            } else weaken(property);
          }
          return;
        }
      }
      weaken(node);
    };
    const weaken = (node: ts.Node) => {
      unknownSpread = true;
      history.push({ ...empty('*', node, true), expression: node.getText(), reasons: ['unknown-spread-keys'] });
      for (const [name] of properties)
        properties.set(name, {
          ...empty(name, node, true),
          expression: node.getText(),
          reasons: ['later-unknown-spread'],
        });
    };
    if (ts.isCallExpression(site)) {
      const argument = site.arguments[0];
      if (argument) {
        if (ts.isSpreadElement(argument)) weaken(argument);
        else spread(argument);
      }
    } else
      for (const attribute of site.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) spread(attribute.expression);
        else {
          const name = attribute.name.getText();
          const initializer = attribute.initializer;
          if (!initializer)
            set(name, attribute, {
              ...empty(name, attribute, false),
              state: 'provided',
              origin: 'fixed',
              representation: 'literal',
              value: true,
            });
          else if (ts.isJsxExpression(initializer))
            set(
              name,
              attribute,
              initializer.expression
                ? { ...readValue(initializer.expression, name), location: reader.location(attribute) }
                : { ...empty(name, attribute, false), state: 'provided' },
            );
          else set(name, attribute, { ...readValue(initializer, name), location: reader.location(attribute) });
        }
      }
    if (ts.isJsxOpeningElement(site) && ts.isJsxElement(site.parent)) {
      const children = site.parent.children.filter((child) => !ts.isJsxText(child) || child.text.trim());
      if (children.length) {
        const parts = children.map((child) =>
          ts.isJsxText(child)
            ? {
                ...empty('children', child, false),
                state: 'provided' as const,
                origin: 'fixed' as const,
                representation: 'literal' as const,
                value: child.text,
              }
            : ts.isJsxExpression(child)
              ? child.expression
                ? readValue(child.expression, 'children')
                : { ...empty('children', child, false), state: 'provided' as const }
              : readValue(child, 'children'),
        );
        const item: SourceCallerValue =
          parts.length === 1
            ? { ...parts[0]!, parts }
            : {
                ...empty('children', site.parent, false),
                state: parts.some((part) => part.state === 'unknown') ? 'unknown' : 'provided',
                origin: 'fixed',
                representation: 'jsx',
                components: parts.flatMap((part) => part.components),
                parts,
              };
        set('children', site.parent, item);
      }
    }
    if (!ts.isCallExpression(site) && !properties.has('children'))
      properties.set('children', empty('children', ts.isJsxOpeningElement(site) ? site.parent : site, unknownSpread));
    for (const name of declared.keys())
      if (!properties.has(name)) properties.set(name, empty(name, site, unknownSpread));
    return { inputs: [...properties.values()], history };
  }
  function emit(
    site: ts.Node,
    targetNode: ts.Node,
    kind: SourceCompilerReference['kind'],
    guards: Conditions,
    ancestors: ts.FunctionLikeDeclaration[],
  ) {
    if (index.references.length >= index.limits.maxReferences) {
      omit('max-reference-records', site);
      return;
    }
    if (kind === 'jsx' && ts.isIdentifier(targetNode) && /^[a-z]/.test(targetNode.text)) return;
    const reasons: string[] = [];
    const targets = resolveTargets(targetNode, [], new Set(), reasons);
    const incoming = targets.some((target) => target.declarationId === index.componentDeclarationId);
    const unresolvedOwned =
      !targets.length && (kind === 'jsx' || kind === 'call') && ancestors.some((owner) => componentOwners.has(owner));
    if (!incoming && !unresolvedOwned) return;
    const item: SourceCompilerReference = {
      id: `${reader.identity(site)}:${kind}`,
      kind,
      expression: site.getText(),
      location: reader.location(site),
      owner: ancestors.length ? reader.location(ancestors[ancestors.length - 1]!) : null,
      ancestors: ancestors.map((owner) => reader.location(owner)),
      conditions: guards,
      targets: [...new Map(targets.map((target) => [JSON.stringify(target), target])).values()],
      inputs: [],
      history: [],
      arguments: [],
      reasons: [...new Set(reasons)].sort(),
    };
    if (ts.isJsxOpeningElement(site) || ts.isJsxSelfClosingElement(site)) Object.assign(item, readInputs(site));
    else if (ts.isCallExpression(site)) {
      Object.assign(item, readInputs(site));
      let shifted = false;
      for (const [position, arg] of site.arguments.entries()) {
        if (ts.isSpreadElement(arg)) {
          shifted = true;
          item.reasons.push('argument-spread-arity');
        }
        item.arguments.push(
          readValue(ts.isSpreadElement(arg) ? arg.expression : arg, `argument:${position}`, shifted ? null : position),
        );
      }
      for (let position = site.arguments.length; position < component.parameters.length; position++)
        item.arguments.push({
          ...empty(component.parameters[position]!.name.getText(), site, shifted),
          parameterIndex: shifted ? null : position,
        });
    }
    index.references.push(item);
  }
  const visit = (node: ts.Node, guards: Conditions, ancestors: ts.FunctionLikeDeclaration[], depth: number) => {
    if (signal?.aborted) {
      omit('reference-collection-cancelled', node);
      return;
    }
    if (index.used.nodes >= index.limits.maxNodes) {
      omit('max-reference-nodes', node);
      return;
    }
    index.used.nodes += 1;
    index.used.depth = Math.max(index.used.depth, depth);
    if (depth > index.limits.maxDepth) {
      omit('max-reference-depth', node);
      return;
    }
    const owners = callable(node) ? [...ancestors, node] : ancestors;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      emit(node, node.tagName, 'jsx', guards, owners);
    else if (ts.isCallExpression(node)) emit(node, node.expression, 'call', guards, owners);
    else if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const parent = node.parent;
      const kind =
        ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)
          ? 'import'
          : ts.isExportSpecifier(parent)
            ? 'reexport'
            : ts.isTypeNode(parent)
              ? 'type'
              : ts.isBinaryExpression(parent) &&
                  parent.left === node &&
                  parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
                  parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
                ? 'assignment'
                : 'value';
      emit(node, node, kind, guards, owners);
    }
    if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) {
      const expression = ts.isIfStatement(node) ? node.expression : node.condition;
      visit(expression, guards, owners, depth + 1);
      if (ts.isIfStatement(node)) {
        visit(node.thenStatement, condition(guards, expression, 'then'), owners, depth + 1);
        if (node.elseStatement) visit(node.elseStatement, condition(guards, expression, 'else'), owners, depth + 1);
      } else {
        visit(node.whenTrue, condition(guards, expression, 'truthy'), owners, depth + 1);
        visit(node.whenFalse, condition(guards, expression, 'falsy'), owners, depth + 1);
      }
      return;
    }
    ts.forEachChild(node, (child) => {
      visit(child, guards, owners, depth + 1);
      return index.used.nodes >= index.limits.maxNodes ? true : undefined;
    });
  };
  for (const file of files.slice(0, index.limits.maxFiles)) {
    if (index.used.nodes >= index.limits.maxNodes) {
      omit('max-reference-nodes', file);
      break;
    }
    index.files.push({
      location: reader.range(file, 0, file.text.length),
      selected: selected.has(reader.location(file).canonicalPath!),
      roles: [selected.has(reader.location(file).canonicalPath!) ? 'selected' : 'context'],
    });
    index.used.files += 1;
    visit(file, [], [], 0);
  }
  index.references.sort(
    (a, b) =>
      a.location.canonicalPath!.localeCompare(b.location.canonicalPath!) ||
      a.location.startOffset! - b.location.startOffset! ||
      a.kind.localeCompare(b.kind),
  );
  index.used.references = index.references.length;
  for (const [name, symbol] of declared) {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    const type = reader.checker.getTypeOfSymbolAtLocation(symbol, declaration ?? component);
    const constituents = type.isUnion() ? type.types : [type];
    const nativeAlternatives = constituents.flatMap<string | number | boolean | null>((part) =>
      part.flags & ts.TypeFlags.StringLiteral
        ? [(part as ts.StringLiteralType).value]
        : part.flags & ts.TypeFlags.NumberLiteral
          ? [(part as ts.NumberLiteralType).value]
          : part.flags & ts.TypeFlags.BooleanLiteral
            ? [(part as ts.Type & { intrinsicName: string }).intrinsicName === 'true']
            : part.flags & ts.TypeFlags.Null
              ? [null]
              : [],
    );
    const alternatives = nativeAlternatives.filter(
      (value) =>
        typeof value !== 'number' ||
        (Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))),
    );
    const summary: SourceReferenceIndex['summaries'][number] = {
      inputName: name,
      inputDeclaration: declaration ? reader.location(declaration) : null,
      constraint: {
        kind:
          alternatives.length === constituents.length
            ? 'finite'
            : type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)
              ? 'unknown'
              : 'open',
        alternatives,
        typeText: reader.checker.typeToString(type),
      },
      counts: { provided: 0, omitted: 0, unknown: 0, fixed: 0, forwarded: 0 },
      samples: [],
      components: [],
      reasons: alternatives.length !== nativeAlternatives.length ? ['unsafe-declared-number'] : [],
    };
    for (const reference of index.references.filter(
      (item) =>
        (item.kind === 'jsx' || item.kind === 'call') &&
        item.targets.some((target) => target.declarationId === index.componentDeclarationId),
    )) {
      const input = reference.inputs.find((item) => item.name === name);
      if (!input) continue;
      summary.counts[input.state] += 1;
      if (input.origin === 'fixed' || input.origin === 'forwarded') summary.counts[input.origin] += 1;
      if (input.value !== undefined)
        summary.samples.push({
          value: input.value,
          location: input.valueLocation ?? input.location,
          referenceId: reference.id,
          violation: summary.constraint.kind === 'finite' && !summary.constraint.alternatives.includes(input.value),
        });
      summary.reasons.push(...input.reasons, ...reference.reasons);
      for (const component of input.components) {
        const known = summary.components.find((item) => item.declarationId === component.declarationId);
        if (known) known.count++;
        else summary.components.push({ ...component, count: 1 });
      }
    }
    summary.reasons = [...new Set([...summary.reasons, 'incoming-caller-coverage-open'])].sort();
    summary.components.sort((a, b) => a.declarationId.localeCompare(b.declarationId));
    index.summaries.push(summary);
  }
  index.summaries.sort((a, b) => a.inputName.localeCompare(b.inputName));
  return index;
}

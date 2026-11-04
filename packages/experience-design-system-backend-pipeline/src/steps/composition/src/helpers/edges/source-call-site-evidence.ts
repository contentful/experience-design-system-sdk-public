import {
  ModuleKind,
  ModuleResolutionKind,
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  VariableDeclarationKind,
  ts,
} from 'ts-morph';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import { createHash } from 'node:crypto';
import type { SharedSourceCallerCoverage } from '@contentful/experience-design-system-types';
import { callerLocation, readCallerInputs, type SourceCallerInput } from './read-caller-inputs.js';
import {
  canonicalSourceFactPath,
  readSourceReferences,
  type SourceCallerValue,
  type SourceReferenceIndex,
} from '../../../../extraction/index.js';
export type { SourceCallerInput } from './read-caller-inputs.js';

export type SourceCallSiteEvidence = {
  parent: string;
  child: string;
  sourcePath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  kind: 'jsx-render';
  execution: 'lexical-reference';
  inputs?: SourceCallerInput[];
  parentSourcePath?: string;
  childSourcePath?: string;
  sourceTextHash?: string;
  startOffset?: number;
  endOffset?: number;
  context?: Array<{ expression: string; startLine: number; endLine: number }>;
  parentDeclarationId?: string | null;
  childDeclarationId?: string;
  lexicalAncestors?: import('../../../../extraction/index.js').SourceFactLocation[];
};

export type SourceCallSiteRejection = {
  parent: string;
  candidate: string;
  sourcePath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  reason: 'unknown-component' | 'unbound-component' | 'ambiguous-component';
};

export type SourceCallSiteEvidenceResult = {
  accepted: SourceCallSiteEvidence[];
  rejected: SourceCallSiteRejection[];
  coverage: SharedSourceCallerCoverage;
};

/** Collect lexical observations; neither execution nor an editable slot contract is implied. */
export function collectSourceCallSiteEvidence(
  files: readonly { path: string; content: string }[],
  components: readonly RawComponentDefinition[],
): SourceCallSiteEvidenceResult {
  return collectConfiguredCallSites(files, components);
}

/** Standalone diagnostics over supplied files; production consumers use the configured shared index. */
export function collectStandaloneSourceCallSiteEvidence(
  files: readonly { path: string; content: string }[],
  components: readonly RawComponentDefinition[],
): SourceCallSiteEvidenceResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      allowJs: true,
    },
  });
  const fileCoverage: SharedSourceCallerCoverage['files'] = [];
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/i.test(file.path)) {
      fileCoverage.push({ path: file.path, status: 'unsupported' });
      continue;
    }
    const source = project.createSourceFile(file.path, file.content, { overwrite: true });
    const syntax = source.compilerNode as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] };
    fileCoverage.push({
      path: source.getFilePath(),
      status: syntax.parseDiagnostics?.length ? 'parse-error' : 'analyzed',
    });
  }

  const componentNames = new Set(components.map(({ name }) => name));
  const sourceCounts = new Map<string, number>();
  for (const component of components) {
    const path = component.sourcePath ?? component.source;
    sourceCounts.set(path, (sourceCounts.get(path) ?? 0) + 1);
  }
  const byDeclaration = new Map<Node, RawComponentDefinition[]>();
  for (const component of components) {
    const source = project.getSourceFile(component.sourcePath ?? component.source);
    if (!source) continue;
    const exported = source.getExportedDeclarations();
    const local = [...source.getFunctions(), ...source.getClasses(), ...source.getVariableDeclarations()].filter(
      (declaration) => declaration.getName() === component.name,
    );
    const declarations = exported.get(component.name) ?? local;
    const anonymousDefault = exported
      .get('default')
      ?.filter(
        (declaration) =>
          Node.isArrowFunction(declaration) ||
          ((Node.isFunctionDeclaration(declaration) ||
            Node.isFunctionExpression(declaration) ||
            Node.isClassDeclaration(declaration)) &&
            !declaration.getName()),
      );
    const roots =
      declarations.length > 0
        ? declarations
        : sourceCounts.get(component.sourcePath ?? component.source) === 1
          ? (anonymousDefault ?? [])
          : [];
    for (const declaration of roots) {
      const owners = byDeclaration.get(declaration) ?? [];
      owners.push(component);
      byDeclaration.set(declaration, owners);
    }
  }

  const accepted: SourceCallSiteEvidence[] = [];
  const rejected: SourceCallSiteRejection[] = [];
  let unownedReferences = 0;
  const seenCallers = new Map<RawComponentDefinition, number>();
  for (const source of project.getSourceFiles()) {
    const lines = source.getFullText().split('\n');
    const references = [
      ...source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
      ...source.getDescendantsOfKind(SyntaxKind.JsxElement),
    ].sort((left, right) => left.getStart() - right.getStart());
    for (const reference of references) {
      const tag = Node.isJsxSelfClosingElement(reference)
        ? reference.getTagNameNode()
        : reference.getOpeningElement().getTagNameNode();
      const expression = tag.getText();
      if (/^[a-z]/.test(expression) && !expression.includes('.')) continue;
      const owner = reference.getAncestors().find((ancestor) => byDeclaration.has(ancestor));
      if (!owner) {
        unownedReferences++;
        continue;
      }
      const candidate = expression.split('.').at(-1)!;
      const children = [
        ...new Set(resolveDeclarations(tag).flatMap((declaration) => byDeclaration.get(declaration) ?? [])),
      ];
      const startLine = reference.getStartLineNumber();
      const endLine = reference.getEndLineNumber();
      const location = {
        sourcePath: source.getFilePath(),
        startLine,
        endLine,
        excerpt: lines
          .slice(startLine - 1, endLine)
          .join('\n')
          .trim(),
      };
      for (const parent of byDeclaration.get(owner)!) {
        if (children.length !== 1) {
          rejected.push({
            parent: parent.name,
            candidate,
            ...location,
            reason:
              children.length > 1
                ? 'ambiguous-component'
                : componentNames.has(candidate)
                  ? 'unbound-component'
                  : 'unknown-component',
          });
          continue;
        }
        for (const child of new Set(children)) {
          seenCallers.set(child, (seenCallers.get(child) ?? 0) + 1);
          if (byDeclaration.get(owner)!.includes(child)) continue;
          accepted.push({
            parent: parent.name,
            child: child.name,
            ...location,
            kind: 'jsx-render',
            execution: 'lexical-reference',
            ...callerLocation(reference),
            parentSourcePath: parent.sourcePath ?? parent.source,
            childSourcePath: child.sourcePath ?? child.source,
            sourceTextHash: createHash('sha256').update(source.getFullText()).digest('hex'),
            context: reference
              .getAncestors()
              .filter(Node.isJsxElement)
              .map((ancestor) => ({
                expression: ancestor.getOpeningElement().getTagNameNode().getText(),
                startLine: ancestor.getStartLineNumber(),
                endLine: ancestor.getEndLineNumber(),
              })),
            inputs: readCallerInputs(reference, [
              ...new Set([...child.props.map((prop) => prop.name), ...child.slots.map((slot) => slot.name)]),
            ]),
          });
        }
      }
    }
  }

  const key = (item: SourceCallSiteEvidence | SourceCallSiteRejection): string =>
    JSON.stringify([
      item.parent,
      'child' in item ? item.child : item.candidate,
      item.sourcePath,
      item.startLine,
      item.endLine,
    ]);
  accepted.sort((left, right) => key(left).localeCompare(key(right)));
  rejected.sort((left, right) => key(left).localeCompare(key(right)));
  const bound = new Set([...byDeclaration.values()].flat());
  const incomplete =
    rejected.length > 0 || unownedReferences > 0 || fileCoverage.some((file) => file.status !== 'analyzed');
  const coverage: SharedSourceCallerCoverage = {
    scope: 'admitted-source',
    analysis: 'lexical-jsx-in-known-component-bodies',
    coverage: 'partial',
    files: fileCoverage.sort((a, b) => a.path.localeCompare(b.path)),
    unresolvedReferences: rejected.length,
    unownedReferences,
    components: components
      .map((component) => {
        const referenceCount = seenCallers.get(component) ?? 0;
        const outcome: SharedSourceCallerCoverage['components'][number]['outcome'] =
          referenceCount > 0 ? 'observed' : !bound.has(component) || incomplete ? 'unknown' : 'not-observed';
        return {
          name: component.name,
          sourcePath: component.sourcePath ?? component.source,
          referenceCount,
          outcome,
          reason:
            outcome === 'observed'
              ? 'Resolved lexical references in admitted component bodies.'
              : outcome === 'unknown'
                ? 'Missing declarations, unsupported source or unresolved references prevent an absence conclusion.'
                : 'No resolved reference in the admitted component bodies; other sources and runtime callers remain unknown.',
        };
      })
      .sort((a, b) => JSON.stringify([a.name, a.sourcePath]).localeCompare(JSON.stringify([b.name, b.sourcePath]))),
  };
  return { accepted, rejected, coverage };
}

function collectConfiguredCallSites(
  files: readonly { path: string; content: string }[],
  components: readonly RawComponentDefinition[],
): SourceCallSiteEvidenceResult {
  const hashes = new Map(
    files.map((file) => [canonicalSourceFactPath(file.path), createHash('sha256').update(file.content).digest('hex')]),
  );
  const indexes = components.flatMap((component) => {
    const read = readSourceReferences(component.componentFacts?.sourceObservations?.referenceIndex);
    if (read.status !== 'available') return [];
    const index = read.evidence;
    const bound =
      canonicalSourceFactPath(component.sourcePath ?? component.source) === index.declaration.canonicalPath &&
      hashes.get(index.declaration.canonicalPath!) === index.declaration.textHash;
    return [{ component, index, bound }];
  });
  const declarations = new Map(
    indexes.filter(({ bound }) => bound).map(({ component, index }) => [index.componentDeclarationId, component]),
  );
  const locationId = (location: SourceReferenceIndex['declaration']) =>
    `${location.canonicalPath}:${location.textHash}:${location.startOffset}:${location.endOffset}`;
  const input = (value: SourceCallerValue): SourceCallerInput => ({
    kind: value.name === 'children' ? 'children' : value.name === '*' ? 'spread' : 'property',
    ...(value.name !== '*' && value.name !== 'children' ? { name: value.name } : {}),
    state: value.state === 'provided' ? (typeof value.value === 'string' ? 'text' : 'supplied') : value.state,
    ...(value.state !== 'omitted' ? { representation: value.representation } : {}),
    ...(value.value !== undefined ? { value: value.value } : {}),
    ...(value.expression !== null && value.value === undefined ? { expression: value.expression } : {}),
    ...(value.reasons.length ? { reason: value.reasons.join(';') } : {}),
    startLine: value.location.startLine!,
    endLine: value.location.endLine!,
    startOffset: value.location.startOffset!,
    endOffset: value.location.endOffset!,
    ...(value.name === 'children' ? { parts: value.parts.map(input) } : {}),
    ...(value.valueLocation
      ? {
          valueSource: {
            sourcePath: value.valueLocation.canonicalPath!,
            startLine: value.valueLocation.startLine!,
            endLine: value.valueLocation.endLine!,
            sourceTextHash: value.valueLocation.textHash!,
          },
        }
      : {}),
  });
  const accepted: SourceCallSiteEvidence[] = [];
  const rejections = new Map<string, SourceCallSiteRejection>();
  let unowned = 0,
    unresolved = 0;
  for (const { component, index, bound } of indexes)
    for (const reference of index.references.filter((reference) => reference.kind === 'jsx')) {
      const ownerId = reference.owner ? locationId(reference.owner) : null;
      const owner = ownerId ? declarations.get(ownerId) : undefined;
      const contextualOwner = [...reference.ancestors]
        .reverse()
        .map((ancestor) => declarations.get(locationId(ancestor)))
        .find(Boolean);
      const parent = owner?.name ?? contextualOwner?.name ?? (ownerId ? `lexical:${ownerId}` : 'unowned');
      const sourceMatches = bound && hashes.get(reference.location.canonicalPath!) === reference.location.textHash;
      if (
        !reference.targets.some((target) => target.declarationId === index.componentDeclarationId) ||
        !sourceMatches
      ) {
        unresolved++;
        rejections.set(reference.id, {
          parent,
          candidate: reference.expression.match(/^<([^\s/>]+)/)?.[1] ?? reference.expression,
          sourcePath: reference.location.canonicalPath!,
          startLine: reference.location.startLine!,
          endLine: reference.location.endLine!,
          excerpt: reference.expression,
          reason: sourceMatches ? 'unknown-component' : 'unbound-component',
        });
        continue;
      }
      if (!ownerId) unowned++;
      if (reference.reasons.length) unresolved++;
      accepted.push({
        parent,
        child: component.name,
        sourcePath: reference.location.canonicalPath!,
        startLine: reference.location.startLine!,
        endLine: reference.location.endLine!,
        startOffset: reference.location.startOffset!,
        endOffset: reference.location.endOffset!,
        sourceTextHash: reference.location.textHash!,
        excerpt: reference.expression,
        kind: 'jsx-render',
        execution: 'lexical-reference',
        inputs: [...reference.inputs.map(input), ...reference.history.filter((value) => value.name === '*').map(input)],
        parentSourcePath: reference.owner?.canonicalPath ?? undefined,
        childSourcePath: index.declaration.canonicalPath!,
        parentDeclarationId: ownerId,
        childDeclarationId: index.componentDeclarationId,
        lexicalAncestors: reference.ancestors,
        context: reference.conditions.map((condition) => ({
          expression: condition.expression,
          startLine: condition.location.startLine!,
          endLine: condition.location.endLine!,
        })),
      });
    }
  accepted.sort(
    (a, b) =>
      a.sourcePath.localeCompare(b.sourcePath) ||
      (a.startOffset ?? 0) - (b.startOffset ?? 0) ||
      a.childDeclarationId!.localeCompare(b.childDeclarationId!),
  );
  const paths = [
    ...new Set(indexes.flatMap(({ index }) => index.files.map((file) => file.location.canonicalPath!))),
  ].sort();
  return {
    accepted,
    rejected: [...rejections.values()],
    coverage: {
      scope: 'admitted-source',
      analysis: 'configured-lexical-references',
      coverage: 'partial',
      files: paths.map((path) => ({ path, status: 'analyzed' })),
      unresolvedReferences: unresolved,
      unownedReferences: unowned,
      components: components.map((component) => {
        const match = indexes.find((item) => item.component === component);
        const referenceCount =
          match?.index.references.filter(
            (item) =>
              match.bound &&
              hashes.get(item.location.canonicalPath!) === item.location.textHash &&
              (item.kind === 'jsx' || item.kind === 'call') &&
              item.targets.some((target) => target.declarationId === match.index.componentDeclarationId),
          ).length ?? 0;
        const covered =
          match?.bound &&
          match.index.coverage === 'complete-within-declared-bound' &&
          match.index.omissions.length === 0 &&
          match.index.files.every(({ location }) => hashes.get(location.canonicalPath!) === location.textHash);
        return {
          name: component.name,
          sourcePath: component.sourcePath ?? component.source,
          referenceCount,
          outcome: referenceCount ? 'observed' : covered ? 'not-observed' : 'unknown',
          reason: !match
            ? 'Shared compiler reference index unavailable; caller coverage remains unknown.'
            : 'Configured lexical observations are partial; unmatched source bytes and incomplete coverage cannot prove missing consumers or execution.',
        };
      }),
    },
  };
}

function resolveDeclarations(reference: Node, seen = new Set<Node>()): Node[] {
  if (seen.has(reference)) return [];
  seen.add(reference);
  const symbol = reference.getSymbol();
  const declarations = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
  return declarations.flatMap((declaration) => {
    if (Node.isVariableDeclaration(declaration)) {
      const initializer = declaration.getInitializer();
      if (
        declaration.getVariableStatement()?.getDeclarationKind() === VariableDeclarationKind.Const &&
        initializer &&
        (Node.isIdentifier(initializer) || Node.isPropertyAccessExpression(initializer))
      ) {
        return resolveDeclarations(initializer, seen);
      }
    }
    return [declaration];
  });
}

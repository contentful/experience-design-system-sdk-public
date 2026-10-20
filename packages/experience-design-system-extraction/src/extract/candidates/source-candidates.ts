import ts from 'typescript';
import { captureNativeSource, decodeSourceDefault } from './native-source.js';
import { sourceLocation } from './source-location.js';
import { resolve } from 'node:path';
import type { Node, Type } from 'ts-morph';
import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../types/component.js';
import type {
  CompilerPropFact,
  SourceCandidate,
  SourceCandidateCollection,
  SourceCandidateObservation,
  SourceCandidateSource,
  SourceDomain,
  SourceDomainLiteral,
  SourceEvidenceKind,
} from './types.js';

const EVIDENCE_ORDER: readonly SourceEvidenceKind[] = ['declaration', 'runtime-object', 'implementation', 'binding'];
const MAX_SOURCE_CANDIDATES = 2_048;

export function retainDuplicateSourceCandidates(
  winner: RawComponentDefinition,
  loser: RawComponentDefinition,
): RawComponentDefinition {
  const alternate: SourceCandidateSource = {
    componentName: loser.name,
    sourcePath: loser.sourcePath ?? loser.source,
    factSchemaVersion: loser.factSchemaVersion ?? null,
    candidates: loser.factSchemaVersion === undefined ? null : (loser.sourceCandidates ?? []),
  };
  const existing = winner.sourceCandidateSources ?? [];
  const additions = [alternate, ...(loser.sourceCandidateSources ?? [])];
  const seen = new Set(existing.map((item) => JSON.stringify(item)));
  const merged = [
    ...existing,
    ...additions.filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
  return { ...winner, sourceCandidateSources: merged };
}

function literalFromTypeNode(node: ts.TypeNode): SourceDomainLiteral | undefined {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'boolean', value: 'true' };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'boolean', value: 'false' };
  if (!ts.isLiteralTypeNode(node)) return undefined;
  const value = node.literal;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return { kind: 'string', value: value.text };
  }
  if (ts.isNumericLiteral(value)) return { kind: 'number', value: value.text };
  if (value.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'boolean', value: 'true' };
  if (value.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'boolean', value: 'false' };
  if (value.kind === ts.SyntaxKind.NullKeyword) return { kind: 'null', value: 'null' };
  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(value.operand)
  ) {
    return { kind: 'number', value: `-${value.operand.text}` };
  }
  return undefined;
}

function parseTypeNode(typeText: string): ts.TypeNode | undefined {
  const source = ts.createSourceFile('__source_fact__.ts', `type __Fact = ${typeText};`, ts.ScriptTarget.Latest, true);
  const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics.length > 0) return undefined;
  const declaration = source.statements.find(ts.isTypeAliasDeclaration);
  return declaration?.type;
}

export function describeSourceDomain(typeText: string): SourceDomain {
  const typeNode = parseTypeNode(typeText);
  if (!typeNode) return { observedLiterals: [], openness: 'unknown' };

  const constituents = ts.isUnionTypeNode(typeNode) ? typeNode.types : [typeNode];
  const observedLiterals: SourceDomainLiteral[] = [];
  let hasBroadPrimitive = false;
  let hasUnknownAlternative = false;

  for (const constituent of constituents) {
    const literal = literalFromTypeNode(constituent);
    if (literal) {
      observedLiterals.push(literal);
      continue;
    }
    if (
      constituent.kind === ts.SyntaxKind.StringKeyword ||
      constituent.kind === ts.SyntaxKind.NumberKeyword ||
      constituent.kind === ts.SyntaxKind.BooleanKeyword ||
      constituent.kind === ts.SyntaxKind.BigIntKeyword ||
      constituent.kind === ts.SyntaxKind.SymbolKeyword
    ) {
      hasBroadPrimitive = true;
      continue;
    }
    if (constituent.kind === ts.SyntaxKind.UndefinedKeyword || constituent.kind === ts.SyntaxKind.NeverKeyword)
      continue;
    hasUnknownAlternative = true;
  }

  const uniqueLiterals = new Map(observedLiterals.map((literal) => [`${literal.kind}:${literal.value}`, literal]));
  const openness = hasUnknownAlternative ? 'unknown' : hasBroadPrimitive ? 'open' : 'closed';
  return {
    observedLiterals: [...uniqueLiterals.values()],
    openness,
  };
}

/** Combine source spelling with checker alternatives without promoting open or unknown members. */
export function describeCompilerDomain(type: Type, sourceTypeText: string): SourceDomain {
  const source = describeSourceDomain(sourceTypeText);
  const alternatives = type.isUnion() ? type.getUnionTypes() : [type];
  const observed = [...source.observedLiterals];
  let openness: SourceDomain['openness'] = 'closed';
  for (const member of alternatives.slice(0, 2048)) {
    if (member.isUndefined() || member.isNever()) continue;
    if (member.isStringLiteral()) observed.push({ kind: 'string', value: String(member.getLiteralValue()) });
    else if (member.isNumberLiteral()) {
      const value = member.getLiteralValue();
      observed.push({ kind: 'number', value: String(value) });
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (Number.isInteger(value) && !Number.isSafeInteger(value))
      )
        openness = 'unknown';
    } else if (member.isBooleanLiteral()) observed.push({ kind: 'boolean', value: member.getText() });
    else if (member.isNull()) observed.push({ kind: 'null', value: 'null' });
    else if (member.isString() || member.isNumber() || member.isBoolean())
      openness = openness === 'unknown' ? 'unknown' : 'open';
    else openness = 'unknown';
  }
  if (alternatives.length > 2048) openness = 'unknown';
  if (source.openness === 'open' && openness === 'closed') openness = 'open';
  return {
    observedLiterals: [...new Map(observed.map((value) => [`${value.kind}:${value.value}`, value])).values()],
    openness,
  };
}

export function observeRawProps(
  props: readonly RawPropDefinition[],
  evidenceKind: SourceEvidenceKind,
  options: {
    origin?: SourceCandidateObservation['origin'];
    sourceDefaults?: ReadonlyMap<string, string>;
    locations?: ReadonlyMap<string, NonNullable<SourceCandidateObservation['location']>>;
  } = {},
): SourceCandidateObservation[] {
  return props.map((prop) => ({
    name: prop.name,
    keyPath: [prop.name],
    evidenceKind,
    type: prop.type,
    declaredRequired: prop.required,
    sourceDefault: options.sourceDefaults?.get(prop.name) ?? prop.defaultValue ?? null,
    origin: options.origin ?? 'unknown',
    location: options.locations?.get(prop.name) ?? null,
  }));
}

function declarationTypeText(declaration: Node): string | undefined {
  const withTypeNode = declaration as Node & { getTypeNode?: () => Node | undefined };
  return withTypeNode.getTypeNode?.()?.getText();
}

function declarationOrigin(declaration: Node, componentSourcePath: string): SourceCandidateObservation['origin'] {
  const sourceFile = declaration.getSourceFile();
  if (resolve(sourceFile.getFilePath()) === resolve(componentSourcePath)) return 'own';
  const program = sourceFile.getProject().getProgram().compilerObject;
  const compilerSource = sourceFile.compilerNode;
  if (program.isSourceFileDefaultLibrary(compilerSource)) {
    return sourceFile.getBaseName().startsWith('lib.dom.') ? 'inherited-dom' : 'inherited-library';
  }
  if (program.isSourceFileFromExternalLibrary(compilerSource)) return 'inherited-library';
  return 'imported';
}

/** Capture facts from actual checker declarations while keeping compiler objects out of the result. */
export function observeTypeProps(
  type: Type,
  props: readonly RawPropDefinition[],
  componentSourcePath: string,
  options: {
    sourceDefaults?: ReadonlyMap<string, string>;
    virtualSource?: { path: string; originalPath: string; sourceHash: string; lineOffset: number };
  } = {},
): SourceCandidateObservation[] {
  return props.map((prop) => {
    const property = type.getProperty(prop.name);
    const declarations = property?.getDeclarations() ?? [];
    const locations = declarations.map((declaration) => {
      const location = sourceLocation(declaration);
      if (
        !options.virtualSource ||
        resolve(declaration.getSourceFile().getFilePath()) !== resolve(options.virtualSource.path)
      ) {
        return location;
      }
      return {
        ...location,
        canonicalPath: resolve(options.virtualSource.originalPath),
        textHash: options.virtualSource.sourceHash,
        startLine: location.startLine === null ? null : location.startLine + options.virtualSource.lineOffset,
        endLine: location.endLine === null ? null : location.endLine + options.virtualSource.lineOffset,
      };
    });
    const origins = new Set(declarations.map((declaration) => declarationOrigin(declaration, componentSourcePath)));
    const origin = origins.size > 1 ? 'mixed' : ([...origins][0] ?? 'unknown');
    const typeTexts = declarations.map(declarationTypeText).filter((text): text is string => Boolean(text));
    const sourceTypeText = typeTexts[0] ?? prop.type;
    const declaredRequired = property ? !property.isOptional() : prop.required;
    const sourceDefault = options.sourceDefaults?.get(prop.name) ?? prop.defaultValue ?? null;
    const fallback =
      declarations[0] ?? type.getSymbol()?.getDeclarations()[0] ?? type.getAliasSymbol()?.getDeclarations()[0];
    const resolved =
      property && fallback
        ? captureNativeSource(property.getTypeAtLocation(fallback), fallback, declaredRequired, [prop.name])
        : null;
    const fact: CompilerPropFact = {
      origin,
      resolvedKind: resolvedKind(sourceTypeText),
      certainty:
        declarations.length === 0
          ? 'unknown'
          : origins.size > 1 || new Set(typeTexts).size > 1
            ? 'ambiguous'
            : 'certain',
      ambiguityReason:
        declarations.length === 0
          ? 'declaration-unavailable'
          : origins.size > 1 || new Set(typeTexts).size > 1
            ? 'conflicting-declarations'
            : null,
      declarations: locations,
      sourceTypeText,
      domain:
        property && fallback
          ? describeCompilerDomain(property.getTypeAtLocation(fallback), sourceTypeText)
          : describeSourceDomain(sourceTypeText),
      declaredRequired,
      sourceDefault: sourceDefault !== null ? decodeSourceDefault(sourceDefault, locations[0] ?? null) : null,
      advisoryShape: resolved?.shape ?? null,
      ...(resolved ? { sourceGraph: resolved.graph } : {}),
      shapeNotes: resolved?.notes ?? ['source-type-location-unavailable'],
      requiredFieldDropped: resolved?.requiredFieldDropped ?? null,
    };
    return {
      name: prop.name,
      keyPath: [prop.name],
      evidenceKind: 'declaration',
      type: prop.type,
      declaredRequired,
      sourceDefault,
      origin,
      location: locations[0] ?? null,
      fact,
    };
  });
}

function resolvedKind(typeText: string): string {
  const typeNode = parseTypeNode(typeText);
  if (!typeNode) return 'unknown';
  if (ts.isFunctionTypeNode(typeNode) || ts.isConstructorTypeNode(typeNode)) return 'callable';
  if (ts.isTupleTypeNode(typeNode)) return 'tuple';
  if (ts.isArrayTypeNode(typeNode)) return 'array';
  if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) return 'union';
  if (ts.isTypeLiteralNode(typeNode)) return 'record';
  if (ts.isIndexedAccessTypeNode(typeNode)) return 'indexed';
  if (
    typeNode.kind === ts.SyntaxKind.StringKeyword ||
    typeNode.kind === ts.SyntaxKind.NumberKeyword ||
    typeNode.kind === ts.SyntaxKind.BooleanKeyword ||
    ts.isLiteralTypeNode(typeNode)
  ) {
    return 'primitive';
  }
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    if (name === 'ComponentType' || name === 'ElementType' || /Component/.test(name)) return 'component-reference';
    if (name === 'Array' || name === 'ReadonlyArray') return 'array';
    if (name === 'Record') return 'record';
    return 'external';
  }
  return 'unknown';
}

export function createFact(observation: SourceCandidateObservation): CompilerPropFact {
  return (
    observation.fact ?? {
      origin: observation.origin,
      resolvedKind: resolvedKind(observation.type),
      certainty: observation.origin === 'unknown' || !observation.location ? 'unknown' : 'certain',
      ambiguityReason: observation.origin === 'unknown' ? 'declaration-origin-unavailable' : null,
      declarations: observation.location ? [observation.location] : [],
      sourceTypeText: observation.type,
      domain: describeSourceDomain(observation.type),
      declaredRequired: observation.declaredRequired,
      sourceDefault: observation.sourceDefault
        ? decodeSourceDefault(observation.sourceDefault, observation.location)
        : null,
      advisoryShape: null,
      shapeNotes: ['bounded-advisory-shape-not-derived'],
      requiredFieldDropped: null,
    }
  );
}

function precedence(observation: SourceCandidateObservation): number {
  return EVIDENCE_ORDER.indexOf(observation.evidenceKind);
}

function stableObservations(observations: readonly SourceCandidateObservation[]): SourceCandidateObservation[] {
  const seen = new Set<string>();
  return observations
    .map((observation, index) => ({ observation, index }))
    .sort((left, right) => precedence(left.observation) - precedence(right.observation) || left.index - right.index)
    .map(({ observation }) => observation)
    .filter((observation) => {
      const key = JSON.stringify(observation);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mergeFact(observations: readonly SourceCandidateObservation[]): CompilerPropFact | null {
  const authoritative = observations.filter((observation) => observation.evidenceKind === 'declaration');
  const selected = authoritative[0] ?? observations[0];
  if (!selected) return null;

  const fact = createFact(selected);
  const declaredFacts = authoritative.map(createFact);
  const origins = new Set(declaredFacts.map((item) => item.origin));
  const sourceTypes = new Set(declaredFacts.map((item) => item.sourceTypeText));
  const syntaxDeclarations = authoritative.filter((observation) => observation.syntax !== undefined);
  const syntaxDefaults = new Set(syntaxDeclarations.map((observation) => observation.sourceDefault));
  const syntaxRequired = new Set(syntaxDeclarations.map((observation) => observation.declaredRequired));
  if (origins.size > 1 || sourceTypes.size > 1 || syntaxDefaults.size > 1 || syntaxRequired.size > 1) {
    return {
      ...fact,
      origin: origins.size > 1 ? 'mixed' : fact.origin,
      certainty: 'ambiguous',
      ambiguityReason: 'conflicting-declarations',
      declarations: declaredFacts.flatMap((item) => item.declarations),
    };
  }
  return syntaxDeclarations.length > 1
    ? { ...fact, declarations: declaredFacts.flatMap((item) => item.declarations) }
    : fact;
}

function projectionFor(
  name: string,
  props: ReadonlySet<string>,
  slots: ReadonlySet<string>,
): SourceCandidate['projection'] {
  if (props.has(name)) return { kind: 'prop', reason: 'current-prop-projection' };
  if (slots.has(name)) return { kind: 'slot', reason: 'current-slot-projection' };
  return { kind: 'excluded', reason: 'current-authoring-projection-omitted' };
}

export function mergeSourceCandidates(
  observations: readonly SourceCandidateObservation[],
  projectedProps: readonly RawPropDefinition[],
  projectedSlots: readonly RawSlotDefinition[],
  maxCandidates = MAX_SOURCE_CANDIDATES,
): SourceCandidateCollection {
  const observationsByName = new Map<string, SourceCandidateObservation[]>();
  for (const observation of observations) {
    const entries = observationsByName.get(observation.name) ?? [];
    entries.push(observation);
    observationsByName.set(observation.name, entries);
  }

  const propNames = new Set(projectedProps.map((prop) => prop.name));
  const slotNames = new Set(projectedSlots.map((slot) => slot.name));
  const names = [...observationsByName.keys()].sort((left, right) => left.localeCompare(right));
  const retainedNames = names.slice(0, Math.max(0, maxCandidates));
  const candidates = retainedNames.map((name): SourceCandidate => {
    const currentObservations = stableObservations(observationsByName.get(name) ?? []);
    const declared = currentObservations.find((observation) => observation.evidenceKind === 'declaration');
    const selected = declared ?? currentObservations[0]!;
    return {
      name,
      keyPath: [...selected.keyPath],
      evidenceKinds: EVIDENCE_ORDER.filter((kind) => currentObservations.some((item) => item.evidenceKind === kind)),
      type: selected.type,
      declaredRequired: selected.declaredRequired,
      sourceDefault: selected.sourceDefault,
      facts: mergeFact(currentObservations),
      observations: currentObservations,
      projection: projectionFor(name, propNames, slotNames),
    };
  });

  return { candidates, omittedCount: names.length - candidates.length };
}

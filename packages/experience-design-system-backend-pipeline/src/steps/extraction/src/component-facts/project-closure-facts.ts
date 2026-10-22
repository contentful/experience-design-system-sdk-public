import type { ComponentFacts, ComponentFactObservation } from '../types/component-facts.js';
import type { SourceFactLocation } from '../candidates/types.js';
import type { SourceObservationContext, SourceSymbolEvidence } from '../types/component-source-observations.js';
import type { SourceClosureFact } from '../../source-closure/source-evidence.js';
import { sourceClosureIdentity } from '../../source-closure/source-evidence.js';
import { deriveClosureFact } from '../../source-closure/evidence.js';

const channels = [
  'renderables',
  'members',
  'childFilters',
  'requiresParent',
  'nonStatic',
  'origin',
  'referencedOrigins',
] as const;
type Channel = (typeof channels)[number];
interface FactReference {
  channel: Channel;
  index: number;
}
interface ReferencedSymbol {
  source: 'subject' | 'operand';
  operandIndex: number | null;
  symbolId: string | null;
  name: string;
  resolution: SourceSymbolEvidence['resolution'];
  declarationIds: string[];
}
export interface ClosureFactProjection {
  rootId: string;
  mode: 'lexical-advisory';
  runtimeApplicability: 'unestablished';
  status: 'available' | 'unavailable';
  reason: string | null;
  sourceBinding: NonNullable<ComponentFacts['sourceClosure']>['binding'];
  closureStatus: NonNullable<ComponentFacts['sourceClosure']>['status'];
  limits: { maxRecords: number };
  usedRecords: number;
  omittedRecords: number;
  summaries: Array<{
    nodeId: string;
    observations: Array<
      SourceClosureFact & { context: SourceObservationContext; referencedSymbols: ReferencedSymbol[] }
    >;
    componentFacts: Array<
      FactReference &
        Pick<SourceClosureFact, 'ownerId' | 'strength' | 'dependsOnOpenEnd' | 'provenance'> & {
          witnessObservationId: string;
        }
    >;
  }>;
  unassignedComponentFacts: Array<FactReference & { reason: string }>;
}

function contains(owner: SourceFactLocation, location: SourceFactLocation): boolean {
  return (
    owner.canonicalPath === location.canonicalPath &&
    owner.textHash === location.textHash &&
    owner.startOffset != null &&
    owner.endOffset != null &&
    location.startOffset != null &&
    location.endOffset != null &&
    owner.startOffset <= location.startOffset &&
    owner.endOffset >= location.endOffset
  );
}

/** Join validated source references; lexical reachability never establishes runtime requirements. */
export function projectClosureFacts(facts: ComponentFacts): ClosureFactProjection | undefined {
  const closure = facts.sourceClosure;
  const collection = facts.sourceObservations;
  if (!closure || !collection) return undefined;
  const reason =
    closure.binding === 'changed'
      ? 'closure-source-changed'
      : closure.binding === 'unavailable'
        ? 'closure-source-unavailable'
        : closure.status === 'failed' || closure.status === 'unavailable'
          ? 'closure-summary-unavailable'
          : null;
  const projection: ClosureFactProjection = {
    rootId: closure.rootId,
    mode: 'lexical-advisory',
    runtimeApplicability: 'unestablished',
    status: reason ? 'unavailable' : 'available',
    reason,
    sourceBinding: closure.binding,
    closureStatus: closure.status,
    limits: { maxRecords: collection.limits.maxObservations },
    usedRecords: 0,
    omittedRecords: 0,
    summaries: [],
    unassignedComponentFacts: [],
  };
  const admit = (): boolean => {
    if (projection.usedRecords >= projection.limits.maxRecords) {
      projection.omittedRecords++;
      return false;
    }
    projection.usedRecords++;
    return true;
  };
  const unassigned = (reference: FactReference, failure: string): void => {
    if (admit()) projection.unassignedComponentFacts.push({ ...reference, reason: failure });
  };
  const assignments: Array<FactReference & { ownerId: string; observation: ComponentFactObservation }> = [];
  const reachableIds = new Set(closure.nodes.map((node) => node.id));
  const lexicalOwners = new Map(closure.nodes.map((node) => [node.id, node.location]));
  for (const observation of collection.observations) {
    const owner = observation.context.lexicalDeclaration;
    if (owner) lexicalOwners.set(sourceClosureIdentity(owner), owner);
  }
  for (const channel of channels) {
    const value = facts[channel];
    const observations: ComponentFactObservation[] = value === undefined ? [] : Array.isArray(value) ? value : [value];
    observations.forEach((observation, index) => {
      const reference = { channel, index };
      const location = observation.location;
      const failure =
        reason ??
        (location?.binding === 'changed'
          ? 'component-fact-source-changed'
          : location?.binding === 'unavailable'
            ? 'component-fact-source-unavailable'
            : !location?.canonicalPath ||
                !location.textHash ||
                location.startOffset == null ||
                location.endOffset == null
              ? 'component-fact-location-unavailable'
              : null);
      if (failure) {
        unassigned(reference, failure);
        return;
      }
      const owners = [...lexicalOwners].filter(([, owner]) => contains(owner, location!));
      owners.sort(
        (left, right) => left[1].endOffset! - left[1].startOffset! - (right[1].endOffset! - right[1].startOffset!),
      );
      if (!owners.length) {
        unassigned(reference, 'component-fact-owner-unobserved');
        return;
      }
      if (
        owners.length > 1 &&
        owners[0]![1].endOffset! - owners[0]![1].startOffset! === owners[1]![1].endOffset! - owners[1]![1].startOffset!
      ) {
        unassigned(reference, 'component-fact-owner-ambiguous');
        return;
      }
      const ownerId = owners[0]![0];
      if (!reachableIds.has(ownerId)) {
        unassigned(reference, 'component-fact-owner-unobserved');
        return;
      }
      assignments.push({ ...reference, ownerId, observation });
    });
  }
  if (reason) return projection;
  const observations = new Map(collection.observations.map((observation) => [observation.id, observation]));
  const summaries = [...closure.summaries].sort((left, right) =>
    left.nodeId === right.nodeId
      ? 0
      : left.nodeId === closure.rootId
        ? -1
        : right.nodeId === closure.rootId
          ? 1
          : left.nodeId.localeCompare(right.nodeId),
  );
  projection.summaries = summaries.map((summary) => ({
    nodeId: summary.nodeId,
    observations: summary.facts.flatMap((fact) => {
      if (!admit()) return [];
      const observation = observations.get(fact.observationId)!;
      const referencedSymbols: ReferencedSymbol[] = [];
      const referenceSymbol = (
        symbol: SourceSymbolEvidence | null,
        source: ReferencedSymbol['source'],
        operandIndex: number | null,
      ): void => {
        if (symbol)
          referencedSymbols.push({
            source,
            operandIndex,
            symbolId: symbol.id,
            name: symbol.name,
            resolution: symbol.resolution,
            declarationIds: symbol.declarations.map((declaration) => declaration.id),
          });
      };
      referenceSymbol(observation.subject, 'subject', null);
      observation.operands?.forEach((operand, index) => referenceSymbol(operand.symbol, 'operand', index));
      return [
        {
          ...fact,
          provenance: [...fact.provenance],
          context: structuredClone(observation.context),
          referencedSymbols,
        },
      ];
    }),
    componentFacts: assignments.flatMap((assignment) => {
      const witness =
        summary.facts.find((fact) => fact.ownerId === assignment.ownerId && fact.kind === 'declaration') ??
        summary.facts.find((fact) => fact.ownerId === assignment.ownerId);
      if (!witness) return [];
      if (!admit()) return [];
      const derived = deriveClosureFact(
        {
          channel: assignment.channel,
          index: assignment.index,
          ownerId: assignment.ownerId,
          witnessObservationId: witness.observationId,
        },
        [{ ...witness, value: witness }],
        {
          strength:
            assignment.observation.certainty === 'certain'
              ? 'exact'
              : assignment.observation.certainty === 'ambiguous'
                ? 'inferred'
                : 'unknown',
        },
      );
      return [
        {
          ...derived.value,
          strength: derived.strength,
          dependsOnOpenEnd: derived.dependsOnOpenEnd,
          provenance: [...derived.provenance],
        },
      ];
    }),
  }));
  return projection;
}

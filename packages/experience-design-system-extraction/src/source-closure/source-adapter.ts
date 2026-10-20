import type {
  ComponentSourceObservation,
  ComponentSourceObservationCollection,
} from '../extract/types/component-source-observations.js';
import type { ClosureNode, ClosureSummary } from './index.js';
import {
  buildClosureGraph,
  orderClosureSccs,
  computeClosureSummaries,
  deriveClosureFact,
  ClosureConvergenceError,
} from './index.js';
import {
  sourceClosureIdentity,
  type SourceClosureEvidence,
  type SourceClosureEnd,
  type SourceClosureNode,
  type SourceObservationFact,
} from './source-evidence.js';

type LocalSource = {
  source: SourceClosureNode;
  observations: ComponentSourceObservation[];
  edgeObservations: Map<string, ComponentSourceObservation[]>;
};
function mergeFact(previous: SourceObservationFact | undefined, next: SourceObservationFact): SourceObservationFact {
  return previous ? deriveClosureFact(next.value, [previous, next]) : next;
}
/** Adapt the producer's bounded compiler observations; never rediscover source on disk. */
export function collectSourceClosure(
  collection: ComponentSourceObservationCollection,
  options: { maxIterations?: number; signal?: AbortSignal } = {},
): SourceClosureEvidence {
  const maxIterations = options.maxIterations ?? 1000;
  if (!Number.isSafeInteger(maxIterations) || maxIterations <= 0)
    throw new RangeError('Closure iteration bound must be a positive safe integer');
  options.signal?.throwIfAborted();
  const locals = new Map<string, LocalSource>();
  const aliases = new Map<string, string>();
  for (const observation of collection.observations) {
    const location = observation.context.lexicalDeclaration;
    if (!location) continue;
    const id = sourceClosureIdentity(location);
    if (!locals.has(id))
      locals.set(id, {
        source: { id, location, observationIds: [], edges: [], ends: [] },
        observations: [],
        edgeObservations: new Map(),
      });
    if (observation.kind === 'declaration')
      for (const declaration of observation.subject?.declarations ?? []) aliases.set(declaration.id, id);
  }
  for (const observation of collection.observations) {
    const id = observation.context.lexicalDeclaration
      ? sourceClosureIdentity(observation.context.lexicalDeclaration)
      : collection.componentDeclarationId;
    const local = locals.get(id);
    if (!local) continue;
    local.observations.push(observation);
    local.source.observationIds.push(observation.id);
  }
  function addEnd(
    local: LocalSource,
    observation: ComponentSourceObservation,
    reason: string,
    kind: SourceClosureEnd['kind'] = 'open',
    target?: string,
  ): void {
    local.source.ends.push({ kind, reason, observationId: observation.id, ...(target ? { target } : {}) });
  }
  for (const local of locals.values()) {
    for (const observation of local.observations) {
      if (observation.kind !== 'call' && observation.kind !== 'jsx') continue;
      const operands =
        observation.operands?.filter((operand) => operand.role === 'callee' || operand.role === 'target') ?? [];
      for (const operand of operands) {
        if (observation.kind === 'jsx' && /^[a-z][A-Za-z0-9]*$/.test(operand.expression)) {
          addEnd(local, observation, 'intrinsic-syntax-terminal', 'dead');
          continue;
        }
        if (operand.inputPath) {
          addEnd(local, observation, 'input-supplied');
          continue;
        }
        const declarations = operand.symbol?.declarations ?? [];
        if (!declarations.length) {
          addEnd(local, observation, operand.expression.includes('[') ? 'dynamic-target' : 'unresolved-target');
          continue;
        }
        for (const declaration of declarations) {
          const target = aliases.get(declaration.id) ?? declaration.id;
          local.source.edges.push({ target, kind: observation.kind });
          const sites = local.edgeObservations.get(target) ?? [];
          sites.push(observation);
          local.edgeObservations.set(target, sites);
          if (!locals.has(target))
            addEnd(
              local,
              observation,
              declaration.origin.repository === 'outside'
                ? 'external-declaration'
                : declaration.kind === 'Parameter' || declaration.kind === 'BindingElement'
                  ? 'input-supplied'
                  : 'declaration-body-unobserved',
              'open',
              target,
            );
        }
      }
    }
    local.source.observationIds.sort();
    local.source.ends = [...new Map(local.source.ends.map((end) => [JSON.stringify(end), end])).values()].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  const reads: SourceClosureEvidence['reads'] = [];
  const graph = buildClosureGraph(
    [collection.componentDeclarationId],
    (id): ClosureNode<LocalSource> | undefined => {
      const local = locals.get(id);
      reads.push({ nodeId: id, outcome: local ? 'read' : 'missing' });
      return local ? { id, data: local, edges: local.source.edges, ends: local.source.ends } : undefined;
    },
    options,
  );
  const groups = orderClosureSccs(graph);
  const nodes = [...graph.nodes.values()].map((node) => ({
    ...node.data.source,
    edges: [...node.edges],
    ends: [...node.ends],
  }));
  const incomplete =
    collection.coverage !== 'complete-within-declared-bound' ||
    nodes.some((node) => node.ends.some((end) => end.kind === 'open'));
  const evidence: SourceClosureEvidence = {
    schemaVersion: 1,
    semantics: 'lexical-source',
    captureBinding: null,
    binding: 'unverified',
    rootId: collection.componentDeclarationId,
    status: graph.missingRoots.length ? 'unavailable' : incomplete ? 'partial' : 'available',
    reason: graph.missingRoots.length
      ? 'root-unobserved'
      : collection.coverage === 'unavailable'
        ? 'source-observations-unavailable'
        : incomplete
          ? 'open-or-omitted-source'
          : null,
    coverage: graph.missingRoots.length ? 'unavailable' : incomplete ? 'partial' : 'complete-within-declared-bound',
    nodes,
    groups,
    summaries: [],
    reads: reads.sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    omissions: collection.omissions.map((item) => ({ ...item })),
    maxIterations,
  };
  function ownFact(node: ClosureNode<LocalSource>, observation: ComponentSourceObservation): SourceObservationFact {
    const open = node.data.source.ends.some((end) => end.kind === 'open' && end.observationId === observation.id);
    return deriveClosureFact({ observationId: observation.id, ownerId: node.id, kind: observation.kind }, [], {
      strength: open
        ? 'unknown'
        : observation.certainty === 'certain'
          ? 'exact'
          : observation.certainty === 'ambiguous'
            ? 'inferred'
            : 'unknown',
      dependsOnOpenEnd: open,
      provenance: [node.id],
    });
  }
  try {
    const summaries = computeClosureSummaries(
      graph,
      {
        bottom: () => ({}),
        transfer(node, get): ClosureSummary {
          const facts = new Map<string, SourceObservationFact>(
            node.data.observations.map((observation) => [observation.id, ownFact(node, observation)]),
          );
          const localIds = new Set(facts.keys());
          for (const target of [...new Set(node.edges.map((edge) => edge.target))].sort()) {
            const dependencies = (node.data.edgeObservations.get(target) ?? []).map((observation) =>
              ownFact(node, observation),
            );
            for (const [id, fact] of Object.entries(get(target) ?? {})) {
              if (localIds.has(id)) continue;
              const inherited = fact as SourceObservationFact;
              const next = deriveClosureFact(inherited.value, [inherited, ...dependencies], {
                strength: 'inferred',
                provenance: [node.id],
              });
              facts.set(id, mergeFact(facts.get(id), next));
            }
          }
          return Object.fromEntries([...facts].sort(([a], [b]) => a.localeCompare(b)));
        },
      },
      options,
    );
    evidence.summaries = [...summaries].map(([nodeId, summary]) => ({
      nodeId,
      facts: Object.values(summary).map((fact) => {
        const source = fact as SourceObservationFact;
        return {
          ...source.value,
          strength: source.strength,
          dependsOnOpenEnd: source.dependsOnOpenEnd,
          provenance: [...source.provenance],
        };
      }),
    }));
  } catch (error) {
    if (!(error instanceof ClosureConvergenceError)) throw error;
    evidence.status = 'failed';
    evidence.reason = 'cycle-nonconvergence';
    evidence.coverage = 'partial';
  }
  return evidence;
}

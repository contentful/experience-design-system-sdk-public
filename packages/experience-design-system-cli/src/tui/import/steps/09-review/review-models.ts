import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { jsonEqual } from '@contentful/experience-design-system-types';
import { buildComponentGraph } from '../07-scope-gate/graph/slot-graph.js';
import { computeAcceptCascade } from './graph/selection-cascade.js';
import type { CdfReviewEntry } from './types.js';

export function reviewSourceOwner(components: CdfReviewEntry[], current: CdfReviewEntry): CdfReviewEntry | undefined {
  const binding = current.entry.$model;
  return binding ? components.find((row) => row.componentId === binding.componentId && !row.entry.$model) : current;
}

export function reviewComponentLabel(components: CdfReviewEntry[], current: CdfReviewEntry): string {
  const binding = current.entry.$model;
  if (!binding) return current.key;
  const owner = reviewSourceOwner(components, current);
  const plan = Object.values(owner?.entry.$representationPlans ?? {}).find((row) => row.id === binding.planId);
  const generated = plan?.models.find((row) => row.key === current.key && row.nodeId === binding.nodeId);
  if (generated && current.key !== generated.originalKey) return current.key;
  const node = plan?.logicalGraph.nodes.find((row) => row.id === binding.nodeId);
  if (!owner || !plan || !node) return current.key;
  const sourcePath =
    node.path[0]?.kind === 'field' && node.path[0].key === plan.identity.key ? node.path.slice(1) : node.path;
  const path = sourcePath
    .map((segment) => {
      if (segment.kind === 'field') return `.${segment.key}`;
      if (segment.kind === 'union' || segment.kind === 'intersection') return `[${segment.kind}:${segment.key}]`;
      return segment.key === undefined ? '[]' : `[${segment.key}]`;
    })
    .join('');
  return `${owner.key}.${plan.identity.key}${path} (${node.kind} model)`;
}

/** Accept a model with its source owner and the owner's full dependency closure. */
export function reviewAcceptCascade(target: CdfReviewEntry, components: CdfReviewEntry[]): Set<string> {
  const owner = reviewSourceOwner(components, target);
  return computeAcceptCascade(owner?.key ?? target.key, buildComponentGraph(components));
}

/** A plan edit can change every model binding; refresh the whole canonical family. */
export function refreshReviewComponents(
  current: CdfReviewEntry[],
  canonical: Array<{ key: string; componentId: string; entry: CDFComponentEntry }>,
): CdfReviewEntry[] {
  const previous = new Map(current.map((row) => [row.componentId ?? row.key, row]));
  const refreshed = canonical.map((row) => {
    const prior = previous.get(row.componentId) ?? previous.get(row.key);
    return { ...row, status: prior?.status ?? ('needs-review' as const) };
  });
  for (const row of refreshed) {
    if (row.entry.$model) continue;
    const prior = previous.get(row.componentId) ?? previous.get(row.key);
    if (prior && jsonEqual(prior.entry.$representationPlans ?? {}, row.entry.$representationPlans ?? {})) continue;
    if (
      row.status === 'accepted' &&
      refreshed.some((model) => model.entry.$model?.componentId === row.componentId && model.status !== 'accepted')
    )
      row.status = 'needs-review';
  }
  return refreshed;
}

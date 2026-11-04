import type { JsonValue, RepresentationPlan } from '@contentful/experience-design-system-types';
import type { ToolCall } from '../../../../../agents/index.js';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import {
  runModelComponentExploration,
  type RunModelComponentExplorationRequest,
} from '../../../../exploration/src/index.js';
import { materializeProperty } from './materialize-property.js';
import { throwIfAborted } from '../../../../../helpers/abort.js';

export async function exploreModelDecisions(
  component: RawComponentDefinition,
  calls: readonly ToolCall[],
  options: Omit<RunModelComponentExplorationRequest, 'plan' | 'sourceOwner'> & {
    componentId?: string;
    representationContext?: (property: string) => JsonValue;
  },
): Promise<ReadonlyMap<string, RepresentationPlan>> {
  const plans = new Map<string, RepresentationPlan>();
  const reservedNames = new Set(options.reservedNames);
  for (const call of calls) {
    throwIfAborted(options.signal);
    if (call.tool !== 'classify_prop' || !call.representation_selection) continue;
    const materialized = materializeProperty(component, call, options.componentId ?? component.name, {
      representationContext: options.representationContext?.(call.prop),
    });
    if (!materialized.selectedRepresentationPlan) throw new Error(`Incomplete model selection for ${call.prop}`);
    const plan = await runModelComponentExploration({
      ...options,
      plan: materialized.selectedRepresentationPlan,
      sourceOwner: { name: component.name, source: component.source },
      reservedNames,
    });
    plans.set(call.prop, plan);
    for (const model of plan.models) reservedNames.add(model.key);
  }
  return plans;
}

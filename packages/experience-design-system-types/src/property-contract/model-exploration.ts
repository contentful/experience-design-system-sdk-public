import { z } from 'zod';
import type { CDFComponentEntry } from '../cdf/types.js';
import type { LogicalSourceNode } from './logical-source-graph.js';
import { cloneJson, jsonEqual, own, type JsonValue } from './json-value.js';
import type { LogicalPhysicalMapping, RepresentationPlan } from './representation-plan.js';

const text = z.string().trim().min(1);
const judgment = {
  name: text,
  description: text,
  reasoning: text,
  sourceNodeIds: z.array(text).min(1),
};

export const ModelComponentExplorationSchema = z
  .object({
    modelKey: text,
    nodeId: text,
    sourceRevision: text,
    name: text,
    description: text,
    properties: z.array(
      z
        .object({
          ...judgment,
          category: z.enum(['content', 'design']),
          authorability: z.enum(['editable', 'fixed', 'uncertain']),
        })
        .strict(),
    ),
    slots: z.array(z.object(judgment).strict()),
    modelingNotes: z.array(text),
  })
  .strict();

export type ModelComponentExploration = z.infer<typeof ModelComponentExplorationSchema>;
export const modelComponentExplorationJsonSchema = z.toJSONSchema(ModelComponentExplorationSchema, {
  target: 'draft-7',
});

/** Apply source-bound authoring judgments before model definitions receive their signed identities. */
export function applyModelComponentExploration(
  input: ModelComponentExploration,
  model: { key: string; nodeId: string; entry: CDFComponentEntry },
  nodes: ReadonlyMap<string, LogicalSourceNode>,
  mappings: Map<string, LogicalPhysicalMapping>,
  sourceRevision: string,
): void {
  const report = ModelComponentExplorationSchema.parse(input);
  if (report.modelKey !== model.key || report.nodeId !== model.nodeId || report.sourceRevision !== sourceRevision)
    throw new Error('Model exploration has a stale or different source owner');
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(report.name) || /^Model_[a-f0-9]{32}$/.test(report.name))
    throw new Error('Model exploration name must be a readable component identifier');
  const exact = (names: string[], expected: string[], subject: string): void => {
    if (new Set(names).size !== names.length || !jsonEqual([...names].sort(), [...expected].sort()))
      throw new Error(`Model exploration must account for every ${subject} exactly once`);
  };
  exact(
    report.properties.map((field) => field.name),
    Object.keys(model.entry.$properties),
    'property',
  );
  exact(
    report.slots.map((slot) => slot.name),
    Object.keys(model.entry.$slots ?? {}),
    'slot',
  );
  const checkNodes = (ids: string[], expected: string[]): void => {
    if (new Set(ids).size !== ids.length || ids.some((id) => !expected.includes(id)))
      throw new Error('Model exploration refers to evidence outside its exact field or slot');
  };
  model.entry.$description = report.description;
  for (const field of report.properties) {
    const mapped = [...mappings.values()].filter(
      (item) => item.componentKey === model.key && item.field === field.name,
    );
    checkNodes(
      field.sourceNodeIds,
      mapped.map((item) => item.nodeId),
    );
    const property = model.entry.$properties[field.name]!;
    if (field.authorability === 'fixed') {
      // A source default or a caller sample does not make a value invariant.
      const value =
        property.$type === 'Literal' && own(property, 'value')
          ? property.value
          : property.$values?.length === 1
            ? property.$values[0]
            : undefined;
      if (!property.$required || value === undefined)
        throw new Error(`Cannot hide ${field.name}: no required intrinsic literal proves a reconstruction value`);
      const root = mapped.find((item) => item.withinValue?.path.length === 0);
      const node = root && nodes.get(root.nodeId);
      if (
        !node ||
        !node.required ||
        node.domain.provenance !== 'compiler' ||
        node.domain.openness !== 'closed' ||
        node.domain.declaredValues.length !== 1 ||
        !jsonEqual(node.domain.declaredValues[0], value) ||
        node.nullable !== false ||
        node.undefinable !== false
      )
        throw new Error(`Cannot hide ${field.name}: source presence or literal identity remains uncertain`);
      for (const item of mapped) {
        item.disposition = 'reconstruction';
        item.reconstruction = { kind: 'fixed-value', value: cloneJson(value as JsonValue) };
        item.reason = field.reasoning;
      }
      delete model.entry.$properties[field.name];
    } else {
      property.$category = field.category;
      property.$description = field.description;
    }
  }
  for (const slot of report.slots) {
    const definition = model.entry.$slots![slot.name]!;
    checkNodes(slot.sourceNodeIds, definition.$modelBinding ? [definition.$modelBinding.nodeId] : []);
    definition.$description = slot.description;
  }
}

export function modelExplorationComplete(plan: RepresentationPlan): boolean {
  return plan.models.every((model) =>
    plan.modelExplorations?.some(
      (report) =>
        report.modelKey === model.originalKey &&
        report.nodeId === model.nodeId &&
        report.sourceRevision === plan.identity.sourceRevision,
    ),
  );
}

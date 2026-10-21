import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  cloneJson,
  jsonEqual,
  own,
  expandCDFModelDependencies,
  deriveEditableRepresentationPlans,
  validateRepresentationPlan,
  evaluateRepresentationReadiness,
  LOCAL_NATIVE_PROPERTY_PROFILE,
  type CDFComponentEntry,
  type RepresentationPlan,
  type PropertyModel,
  type JsonValue,
  type RepresentationProposalDraft,
} from '@contentful/experience-design-system-types';
import { loadRawComponents, loadPropertyDecisions, loadCDFComponents, storeCDFComponents } from './db.js';
import { materializeProperty } from '../../../../steps/generation/src/services/property/materialize-property.js';
import { definitionCall } from '../../../../steps/generation/src/services/property/definition-call.js';

export function initializeRepresentationSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS selected_representation_plans (
    session_id TEXT NOT NULL, component_id TEXT NOT NULL, property_name TEXT NOT NULL,
    revision INTEGER NOT NULL, plan_json TEXT NOT NULL, producer_json TEXT NOT NULL,
    PRIMARY KEY (session_id, component_id, property_name)
  )`);
}
export function representationContext(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propertyName: string,
): JsonValue {
  const tokens = db
    .prepare(
      `SELECT p.path,t.type,t.value FROM raw_prop_token_paths p
    LEFT JOIN raw_tokens t ON t.session_id=p.session_id AND t.path=p.path
    WHERE p.session_id=? AND p.component_id=? AND p.prop_name=? ORDER BY p.position`,
    )
    .all(sessionId, componentId, propertyName);
  const defaults = db
    .prepare(
      `SELECT p.default_value,n.path,t.type,t.value FROM raw_props p
    LEFT JOIN raw_token_name_paths n ON n.session_id=p.session_id AND n.raw_name=p.default_value
    LEFT JOIN raw_tokens t ON t.session_id=n.session_id AND t.path=n.path
    WHERE p.session_id=? AND p.component_id=? AND p.name=?`,
    )
    .all(sessionId, componentId, propertyName);
  return cloneJson({ profile: LOCAL_NATIVE_PROPERTY_PROFILE, tokens, defaults }) as JsonValue;
}
export function currentRepresentationModel(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propertyName: string,
): PropertyModel {
  const sources = loadRawComponents(db, sessionId).filter((component) => component.component_id === componentId);
  if (sources.length !== 1 || sources[0]!.sourceEvidenceReadStatus !== 'available')
    throw new Error('Current complete representation source unavailable');
  const saved = loadPropertyDecisions(db, sessionId).find(
    (decision) => decision.componentId === componentId && decision.propertyName === propertyName,
  );
  if (!saved) throw new Error('Representation requires a complete source property decision');
  const record = saved.decision as {
    model?: PropertyModel;
    defaultIntent?: PropertyModel['defaultIntent'];
    disposition?: string;
    reviewAuthority?: unknown;
  };
  if (record.disposition === 'exclude') throw new Error('Excluded property cannot receive a representation');
  const call = saved.definition
    ? definitionCall(propertyName, saved.definition, record.defaultIntent)
    : {
        tool: 'classify_prop' as const,
        prop: propertyName,
        cdf_category:
          record.model?.category === 'unattached'
            ? ('content' as const)
            : (record.model?.category ?? ('content' as const)),
        reason: 'Editable representation review',
        ...(record.defaultIntent ? { default_intent: record.defaultIntent } : {}),
      };
  const materialized = materializeProperty(sources[0]!, call, componentId, {
    defaultAuthority: record.reviewAuthority ? 'review' : 'generation',
  });
  if (!materialized.model) throw new Error('Canonical representation source model unavailable');
  return materialized.model;
}
export function analyzePropertyRepresentations(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propertyName: string,
): RepresentationPlan[] {
  const model = currentRepresentationModel(db, sessionId, componentId, propertyName);
  return deriveEditableRepresentationPlans(model, {
    context: representationContext(db, sessionId, componentId, propertyName),
  });
}
export function loadRepresentationPlans(
  db: DatabaseSync,
  sessionId: string,
  componentId?: string,
): Array<{ componentId: string; propertyName: string; revision: number; plan: RepresentationPlan }> {
  const rows = db
    .prepare(
      'SELECT component_id,property_name,revision,plan_json FROM selected_representation_plans WHERE session_id=? ORDER BY component_id,property_name',
    )
    .all(sessionId) as Array<{ component_id: string; property_name: string; revision: number; plan_json: string }>;
  return rows
    .filter((row) => componentId === undefined || row.component_id === componentId)
    .map((row) => ({
      componentId: row.component_id,
      propertyName: row.property_name,
      revision: row.revision,
      plan: JSON.parse(row.plan_json) as RepresentationPlan,
    }));
}
function editsFor(plan: RepresentationPlan): Record<string, CDFComponentEntry> {
  const edits: Record<string, CDFComponentEntry> = Object.create(null);
  for (const generated of plan.models) {
    if (own(edits, generated.key)) throw new Error('Duplicate representation model');
    edits[generated.key] = cloneJson(generated.entry);
    delete edits[generated.key]!.$model;
    for (const slot of Object.values(edits[generated.key]!.$slots ?? {}))
      if (slot.$modelBinding) slot.$modelBinding.planId = '';
  }
  return edits;
}
export function prepareEntryRepresentationPlans(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  input: CDFComponentEntry,
): CDFComponentEntry {
  const entry = cloneJson(input);
  const prior = loadRepresentationPlans(db, sessionId, componentId);
  for (const [propertyName, candidate] of Object.entries(entry.$representationPlans ?? {})) {
    const model = currentRepresentationModel(db, sessionId, componentId, propertyName);
    const context = representationContext(db, sessionId, componentId, propertyName);
    let plan = cloneJson(candidate);
    const issues = validateRepresentationPlan(plan, model, context);
    if (issues.length) {
      const previous = prior.find((row) => row.propertyName === propertyName)?.plan;
      if (!previous || previous.id !== plan.id || validateRepresentationPlan(previous, model, context).length)
        throw new Error(issues.map((issue) => issue.message).join('; '));
      const unchanged = { ...plan, models: previous.models, defaultIntent: previous.defaultIntent };
      if (!jsonEqual(unchanged, previous)) throw new Error('Edited plan changes immutable owner or mapping evidence');
      plan = deriveEditableRepresentationPlans(model, {
        context,
        modelEdits: editsFor(plan),
        defaultIntent: plan.defaultIntent,
        ...(plan.proposal ? { proposal: plan.proposal } : {}),
      }).find((choice) => choice.kind === plan.kind)!;
      if (!plan || validateRepresentationPlan(plan, model, context).length)
        throw new Error('Edited source model plan is not valid');
    }
    if (plan.identity.componentId !== componentId || plan.identity.key !== propertyName)
      throw new Error('Representation owner mismatch');
    if (plan.kind === 'component-model') {
      if (own(entry.$properties, propertyName))
        throw new Error('Property and representation slot compete for source owner');
      if (
        !plan.attachment ||
        !entry.$slots?.[plan.attachment.slot] ||
        !jsonEqual(entry.$slots![plan.attachment.slot], candidate.attachment?.definition)
      )
        throw new Error('Representation root attachment missing or altered');
      entry.$slots![plan.attachment.slot] = cloneJson(plan.attachment.definition);
    } else if (!jsonEqual(entry.$properties[propertyName], plan.nativeDefinition))
      throw new Error('Native representation definition disagrees with selected plan');
    entry.$representationPlans![propertyName] = plan;
  }
  for (const row of prior)
    if (!entry.$representationPlans?.[row.propertyName] && !own(entry.$properties, row.propertyName))
      throw new Error('Selected representation removed without restoring source decision');
  return entry;
}
export function saveEntryRepresentationPlans(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  entry: CDFComponentEntry,
): void {
  const previous = loadRepresentationPlans(db, sessionId, componentId);
  for (const row of previous)
    if (!entry.$representationPlans || !own(entry.$representationPlans, row.propertyName))
      db.prepare(
        'DELETE FROM selected_representation_plans WHERE session_id=? AND component_id=? AND property_name=?',
      ).run(sessionId, componentId, row.propertyName);
  for (const [propertyName, plan] of Object.entries(entry.$representationPlans ?? {})) {
    if (previous.some((row) => row.propertyName === propertyName && jsonEqual(row.plan, plan))) continue;
    db.prepare(
      `INSERT INTO selected_representation_plans(session_id,component_id,property_name,revision,plan_json,producer_json) VALUES (?,?,?,1,?,?)
      ON CONFLICT(session_id,component_id,property_name) DO UPDATE SET revision=revision+1,plan_json=excluded.plan_json,producer_json=excluded.producer_json`,
    ).run(
      sessionId,
      componentId,
      propertyName,
      JSON.stringify(plan),
      JSON.stringify({ kind: 'review', id: randomUUID() }),
    );
  }
}
export function overlayRepresentationPlans(
  db: DatabaseSync,
  sessionId: string,
  components: Array<{ key: string; componentId: string; entry: CDFComponentEntry }>,
): Array<{ key: string; componentId: string; entry: CDFComponentEntry }> {
  const plans = loadRepresentationPlans(db, sessionId);
  return components.map((component) => {
    const owned = plans.filter((row) => row.componentId === component.componentId);
    if (!owned.length) return component;
    const entry = cloneJson(component.entry);
    entry.$representationPlans = Object.create(null);
    for (const row of owned) {
      entry.$representationPlans![row.propertyName] = cloneJson(row.plan);
      if (row.plan.kind === 'component-model' && row.plan.attachment) {
        delete entry.$properties[row.propertyName];
        entry.$slots ??= Object.create(null);
        if (own(entry.$slots!, row.plan.attachment.slot))
          throw new Error('Source slot and generated model attachment collide');
        entry.$slots![row.plan.attachment.slot] = cloneJson(row.plan.attachment.definition);
      } else if (row.plan.nativeDefinition) entry.$properties[row.propertyName] = cloneJson(row.plan.nativeDefinition);
    }
    return { ...component, entry };
  });
}
export function selectedRepresentationValidity(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
): { valid: boolean; issues: string[]; heldProperties: Set<string> } {
  const issues: string[] = [],
    heldProperties = new Set<string>();
  for (const row of loadRepresentationPlans(db, sessionId, componentId)) {
    try {
      const model = currentRepresentationModel(db, sessionId, componentId, row.propertyName);
      const invalid = validateRepresentationPlan(
        row.plan,
        model,
        representationContext(db, sessionId, componentId, row.propertyName),
      );
      issues.push(...invalid.map((issue) => issue.message));
      if (invalid.length || !evaluateRepresentationReadiness(row.plan).ready) heldProperties.add(row.propertyName);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'Representation source unavailable');
      heldProperties.add(row.propertyName);
    }
  }
  return { valid: !issues.length, issues, heldProperties };
}
export function expandRepresentationClosure(
  components: Array<{ key: string; componentId: string; entry: CDFComponentEntry }>,
): Array<{ key: string; componentId: string; entry: CDFComponentEntry }> {
  return expandCDFModelDependencies(components).map((component) => ({
    ...component,
    componentId: 'componentId' in component ? component.componentId : component.entry.$model!.nodeId,
  }));
}
export function selectRepresentationPlan(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propertyName: string,
  kind: RepresentationPlan['kind'],
  proposal?: RepresentationProposalDraft,
): CDFComponentEntry {
  const choices = proposal
    ? deriveEditableRepresentationPlans(currentRepresentationModel(db, sessionId, componentId, propertyName), {
        context: representationContext(db, sessionId, componentId, propertyName),
        proposal,
      })
    : analyzePropertyRepresentations(db, sessionId, componentId, propertyName);
  const plan = choices.find((choice) => choice.kind === kind && choice.sdkValid);
  if (!plan) throw new Error('Editable representation unavailable for current source');
  const component = loadCDFComponents(db, sessionId).find((entry) => entry.componentId === componentId);
  if (!component) throw new Error('Representation component unavailable');
  const entry = cloneJson(component.entry);
  const old = entry.$representationPlans?.[propertyName];
  if (old?.attachment && entry.$slots) delete entry.$slots![old.attachment.slot];
  entry.$representationPlans ??= Object.create(null);
  entry.$representationPlans![propertyName] = plan;
  if (plan.kind === 'component-model' && plan.attachment) {
    delete entry.$properties[propertyName];
    entry.$slots ??= Object.create(null);
    entry.$slots![plan.attachment.slot] = cloneJson(plan.attachment.definition);
  } else if (plan.nativeDefinition) entry.$properties[propertyName] = cloneJson(plan.nativeDefinition);
  storeCDFComponents(db, sessionId, [{ ...component, entry }]);
  return loadCDFComponents(db, sessionId).find((row) => row.componentId === componentId)!.entry;
}

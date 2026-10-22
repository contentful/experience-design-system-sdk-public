import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  cloneJson,
  jsonEqual,
  own,
  expandCDFModelDependencies,
  deriveEditableRepresentationPlans,
  prepareAnalysisRepresentationCandidates,
  type AnalysisRepresentationCandidates,
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
import { sourcePropertyModel } from '../../../../steps/generation/src/services/property/source-property-model.js';
import { definitionCall } from '../../../../steps/generation/src/services/property/definition-call.js';

export function initializeRepresentationSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS selected_representation_plans (
    session_id TEXT NOT NULL, component_id TEXT NOT NULL, property_name TEXT NOT NULL,
    revision INTEGER NOT NULL, plan_json TEXT NOT NULL, producer_json TEXT NOT NULL,
    PRIMARY KEY (session_id, component_id, property_name)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS representation_plan_history (
    session_id TEXT NOT NULL, component_id TEXT NOT NULL, property_name TEXT NOT NULL,
    plan_id TEXT NOT NULL, parent_plan_id TEXT, plan_json TEXT NOT NULL, producer_json TEXT NOT NULL,
    PRIMARY KEY (session_id, component_id, property_name, plan_id)
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
/** Fresh saved source supports strategy discovery before a semantic property decision exists. */
export function analyzePropertyRepresentationCandidates(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propertyName: string,
): AnalysisRepresentationCandidates {
  const sources = loadRawComponents(db, sessionId).filter((component) => component.component_id === componentId);
  if (sources.length !== 1 || sources[0]!.sourceEvidenceReadStatus !== 'available')
    throw new Error('Current representation source unavailable');
  const model = sourcePropertyModel(sources[0]!, propertyName, componentId);
  if (!model) throw new Error('Source property graph unavailable');
  return prepareAnalysisRepresentationCandidates(model);
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
    call?: import('@contentful/experience-design-system-types').ClassifiedPropertyCall;
  };
  if (record.disposition === 'exclude') throw new Error('Excluded property cannot receive a representation');
  const call = saved.definition
    ? definitionCall(
        propertyName,
        saved.definition,
        record.defaultIntent,
        record.call?.representation_proposal,
        record.call,
      )
    : (record.call ?? {
        tool: 'classify_prop' as const,
        prop: propertyName,
        cdf_category:
          record.model?.category === 'unattached'
            ? ('content' as const)
            : (record.model?.category ?? ('content' as const)),
        reason: 'Editable representation review',
        ...(record.defaultIntent ? { default_intent: record.defaultIntent } : {}),
      });
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
  const context = representationContext(db, sessionId, componentId, propertyName);
  const derived = deriveEditableRepresentationPlans(model, { context });
  const saved = db
    .prepare(
      'SELECT plan_json FROM representation_plan_history WHERE session_id=? AND component_id=? AND property_name=? ORDER BY rowid',
    )
    .all(sessionId, componentId, propertyName) as Array<{ plan_json: string }>;
  for (const row of saved) {
    const plan = JSON.parse(row.plan_json) as RepresentationPlan;
    if (
      !derived.some((candidate) => candidate.id === plan.id) &&
      !validateRepresentationPlan(plan, model, context).length
    )
      derived.push(plan);
  }
  return derived;
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
  const originalKeys = new Map(plan.models.map((generated) => [generated.key, generated.originalKey]));
  for (const generated of plan.models) {
    if (own(edits, generated.originalKey) || originalKeys.size !== plan.models.length)
      throw new Error('Duplicate representation model');
    edits[generated.originalKey] = cloneJson(generated.entry);
    delete edits[generated.originalKey]!.$model;
    for (const slot of Object.values(edits[generated.originalKey]!.$slots ?? {})) {
      if (slot.$modelBinding) slot.$modelBinding.planId = '';
      if (slot.$allowedComponents)
        slot.$allowedComponents = slot.$allowedComponents.map((key) => originalKeys.get(key) ?? key);
    }
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
      if (
        plan.models.length !== previous.models.length ||
        plan.models.some((generated) => {
          const original = previous.models.find((row) => row.originalKey === generated.originalKey);
          return (
            !original ||
            generated.nodeId !== original.nodeId ||
            !jsonEqual(generated.entry.$model, original.entry.$model)
          );
        })
      )
        throw new Error('Edited model changes immutable source identity');
      plan = deriveEditableRepresentationPlans(model, {
        context,
        modelEdits: editsFor(plan),
        modelRenames: Object.fromEntries(plan.models.map((generated) => [generated.originalKey, generated.key])),
        ...(plan.modelExplorations ? { modelExplorations: plan.modelExplorations } : {}),
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
    const reserved = new Set(
      (db.prepare('SELECT name FROM raw_components WHERE session_id=?').all(sessionId) as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    for (const other of loadRepresentationPlans(db, sessionId))
      if (other.componentId !== componentId || other.propertyName !== propertyName)
        for (const generated of other.plan.models) reserved.add(generated.key);
    if (plan.models.some((generated) => reserved.has(generated.key)))
      throw new Error('Edited model name collides with another component');
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
  producer: { kind: 'generation' | 'review'; id: string } = { kind: 'review', id: randomUUID() },
): void {
  const previous = loadRepresentationPlans(db, sessionId, componentId);
  const archive = (propertyName: string, plan: RepresentationPlan, parentId: string | null): void => {
    const existing = db
      .prepare(
        'SELECT plan_json FROM representation_plan_history WHERE session_id=? AND component_id=? AND property_name=? AND plan_id=?',
      )
      .get(sessionId, componentId, propertyName, plan.id) as { plan_json: string } | undefined;
    if (existing) {
      if (!jsonEqual(JSON.parse(existing.plan_json), plan))
        throw new Error('Immutable representation history disagrees');
      return;
    }
    db.prepare(
      'INSERT INTO representation_plan_history(session_id,component_id,property_name,plan_id,parent_plan_id,plan_json,producer_json) VALUES (?,?,?,?,?,?,?)',
    ).run(sessionId, componentId, propertyName, plan.id, parentId, JSON.stringify(plan), JSON.stringify(producer));
  };
  for (const row of previous) archive(row.propertyName, row.plan, null);
  for (const [propertyName, plan] of Object.entries(entry.$representationPlans ?? {}))
    archive(propertyName, plan, previous.find((row) => row.propertyName === propertyName)?.plan.id ?? null);
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
    ).run(sessionId, componentId, propertyName, JSON.stringify(plan), JSON.stringify(producer));
  }
}

/** Called inside the owning generation transaction after its semantic decision is saved. */
export function saveGeneratedRepresentationPlan(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  plan: RepresentationPlan,
  producer: { kind: 'generation'; id: string },
): void {
  const model = currentRepresentationModel(db, sessionId, componentId, plan.identity.key);
  const issues = validateRepresentationPlan(
    plan,
    model,
    representationContext(db, sessionId, componentId, plan.identity.key),
  );
  if (issues.length) throw new Error(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  if (plan.identity.componentId !== componentId) throw new Error('Generated representation owner mismatch');
  const prior = loadRepresentationPlans(db, sessionId, componentId);
  const plans = Object.fromEntries(prior.map((row) => [row.propertyName, row.plan]));
  plans[plan.identity.key] = plan;
  const reserved = new Set(
    (db.prepare('SELECT name FROM raw_components WHERE session_id=?').all(sessionId) as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  for (const row of loadRepresentationPlans(db, sessionId))
    if (row.componentId !== componentId || row.propertyName !== plan.identity.key)
      for (const generated of row.plan.models) reserved.add(generated.key);
  if (plan.models.some((generated) => reserved.has(generated.key)))
    throw new Error('Generated model name collides with another component');
  saveEntryRepresentationPlans(
    db,
    sessionId,
    componentId,
    { $type: 'component', $properties: {}, $representationPlans: plans },
    producer,
  );
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
      const model = currentRepresentationModel(db, sessionId, component.componentId, row.propertyName);
      const invalid = validateRepresentationPlan(
        row.plan,
        model,
        representationContext(db, sessionId, component.componentId, row.propertyName),
      );
      // Context-stale selections remain readable for readoption; current readiness and save validation still gate use.
      if (invalid.length && validateRepresentationPlan(row.plan, model, row.plan.contextSnapshot).length)
        throw new Error('Saved representation is stale: ' + invalid.map((issue) => issue.message).join('; '));
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
/** Reject incompatible preserved selections before the owning write commits. */
export function assertPreservedRepresentationSelections(
  db: DatabaseSync,
  sessionId: string,
  componentId?: string,
): void {
  const owners = new Set(loadRepresentationPlans(db, sessionId, componentId).map((row) => row.componentId));
  for (const owner of owners) {
    const validity = selectedRepresentationValidity(db, sessionId, owner);
    if (!validity.valid) throw new Error('Saved representation selection is stale: ' + validity.issues.join('; '));
  }
}
export function expandRepresentationClosure(
  components: Array<{ key: string; componentId: string; entry: CDFComponentEntry }>,
): Array<{ key: string; componentId: string; entry: CDFComponentEntry }> {
  return expandCDFModelDependencies(components).map((component) => ({
    ...component,
    componentId:
      'componentId' in component
        ? component.componentId
        : 'model:' +
          createHash('sha256')
            .update(
              JSON.stringify([
                component.entry.$model!.componentId,
                component.entry.$model!.propertyId,
                component.entry.$model!.nodeId,
              ]),
            )
            .digest('hex'),
  }));
}

/** Review the same complete definitions that accompany source roots on export. */
export function loadReviewCDFComponents(
  db: DatabaseSync,
  sessionId: string,
): Array<{ key: string; componentId: string; entry: CDFComponentEntry }> {
  return expandRepresentationClosure(loadCDFComponents(db, sessionId));
}

/** Model edits belong to the owner's selected plan, not to fabricated source rows. */
export function storeReviewCDFComponent(
  db: DatabaseSync,
  sessionId: string,
  component: { key: string; componentId?: string },
  input: CDFComponentEntry,
): void {
  const rows = loadReviewCDFComponents(db, sessionId);
  const matches = rows.filter((row) =>
    component.componentId ? row.componentId === component.componentId : row.key === component.key,
  );
  if (matches.length !== 1 || matches[0]!.key !== component.key)
    throw new Error('Unknown or ambiguous review component identity');
  const current = matches[0]!;
  const binding = current.entry.$model;
  if (!binding) {
    storeCDFComponents(db, sessionId, [{ ...current, entry: input }]);
    return;
  }
  if (!jsonEqual(binding, input.$model) || input.$representationPlans)
    throw new Error('Edited model changes immutable source identity');
  const owner = rows.find((row) => row.componentId === binding.componentId && !row.entry.$model);
  if (!owner) throw new Error('Representation model owner unavailable');
  const entry = cloneJson(owner.entry);
  const plan = Object.values(entry.$representationPlans ?? {}).find((candidate) => candidate.id === binding.planId);
  const model = plan?.models.find((candidate) => candidate.nodeId === binding.nodeId && candidate.key === current.key);
  if (!model) throw new Error('Representation model is not owned by the selected plan');
  model.entry = cloneJson(input);
  storeCDFComponents(db, sessionId, [{ ...owner, entry }]);
}
export function selectRepresentationPlan(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propertyName: string,
  kind: RepresentationPlan['kind'],
  proposal?: RepresentationProposalDraft,
  candidateId?: string,
): CDFComponentEntry {
  const choices = proposal
    ? deriveEditableRepresentationPlans(currentRepresentationModel(db, sessionId, componentId, propertyName), {
        context: representationContext(db, sessionId, componentId, propertyName),
        proposal,
      })
    : analyzePropertyRepresentations(db, sessionId, componentId, propertyName);
  const plan = choices.find(
    (choice) => choice.kind === kind && choice.sdkValid && (candidateId === undefined || choice.id === candidateId),
  );
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

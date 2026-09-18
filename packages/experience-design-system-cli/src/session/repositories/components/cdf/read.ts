import type { DatabaseSync } from 'node:sqlite';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { indexRowsByKey } from '../../../core/shared/index-rows-by-key.js';
import { getRawTokenNamePaths } from '../../tokens/read.js';

export interface ComponentRationale {
  name: string;
  description: string | null;
  descriptionRationale: string | null;
  propsRationale: string | null;
  slotsRationale: string | null;
  props: Array<{ name: string; category: string | null; description: string | null; rationale: string | null }>;
  slots: Array<{ name: string; description: string | null; rationale: string | null }>;
}

export type ScopeComponentRow = {
  name: string;
  componentId: string;
  aiDecision: 'accepted' | 'rejected' | null;
  aiReason: string | null;
  needsReview: boolean;
  slots: Array<{ name: string; allowedComponents: string[] }>;
};

function parseReviewReasons(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((reason): reason is string => typeof reason === 'string') : [];
  } catch {
    return [];
  }
}

export function getCdfComponents(
  db: DatabaseSync,
  sessionId: string,
): Array<{ key: string; entry: CDFComponentEntry }> {
  const components = db
    .prepare(
      `SELECT component_id, name, description FROM raw_components
       WHERE session_id = ? AND status = 'generated' ORDER BY rowid`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      name: String(row.name),
      description: row.description === null ? null : String(row.description),
    }));

  if (components.length === 0) return [];

  const props = db
    .prepare(
      `SELECT component_id, name, required, default_value, description,
              cdf_type, cdf_category, cdf_token_kind, position
       FROM raw_props
       WHERE session_id = ? AND cdf_type IS NOT NULL
       ORDER BY component_id, position`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      name: String(row.name),
      required: Number(row.required),
      default_value: row.default_value === null ? null : String(row.default_value),
      description: row.description === null ? null : String(row.description),
      cdf_type: String(row.cdf_type),
      cdf_category: String(row.cdf_category),
      cdf_token_kind: row.cdf_token_kind === null ? null : String(row.cdf_token_kind),
      position: Number(row.position),
    }));

  const allowedValues = db
    .prepare(
      `SELECT component_id, prop_name, value, position
       FROM raw_prop_allowed_values WHERE session_id = ? ORDER BY component_id, prop_name, position`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      prop_name: String(row.prop_name),
      value: String(row.value),
      position: Number(row.position),
    }));

  const slots = db
    .prepare(
      `SELECT component_id, name, description, required FROM raw_slots WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      name: String(row.name),
      description: row.description === null ? null : String(row.description),
      required: Number(row.required),
    }));

  const allowedComponents = db
    .prepare(
      `SELECT component_id, slot_name, allowed_component
       FROM raw_slot_allowed_components WHERE session_id = ? ORDER BY component_id, slot_name, position`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      slot_name: String(row.slot_name),
      allowed_component: String(row.allowed_component),
    }));

  const tokenPaths = db
    .prepare(
      `SELECT component_id, prop_name, position, path
       FROM raw_prop_token_paths WHERE session_id = ? ORDER BY component_id, prop_name, position`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      prop_name: String(row.prop_name),
      position: Number(row.position),
      path: String(row.path),
    }));

  const resolvedDefaultPaths = getRawTokenNamePaths(db, sessionId);
  const tokenTypeByPath = new Map(
    db
      .prepare('SELECT path, type FROM raw_tokens WHERE session_id = ?')
      .all(sessionId)
      .map((token) => [String(token.path), String(token.type)]),
  );

  const propsByComponent = indexRowsByKey(props, (p) => p.component_id);
  const allowedValuesByProp = indexRowsByKey(allowedValues, (av) => `${av.component_id}::${av.prop_name}`);
  const slotsByComponent = indexRowsByKey(slots, (s) => s.component_id);
  const allowedComponentsBySlot = indexRowsByKey(allowedComponents, (ac) => `${ac.component_id}::${ac.slot_name}`);
  const tokenPathsByProp = indexRowsByKey(tokenPaths, (t) => `${t.component_id}::${t.prop_name}`);
  const toTokenPaths = (rows: typeof tokenPaths | undefined): string[] | undefined =>
    rows === undefined ? undefined : rows.map((r) => r.path);

  return components.map(({ component_id, name, description }) => {
    const compProps = propsByComponent.get(component_id) ?? [];

    const $properties: CDFComponentEntry['$properties'] = {};
    for (const p of compProps) {
      if (!p.name.trim()) continue;
      const av = allowedValuesByProp.get(`${component_id}::${p.name}`);
      const propDef: CDFComponentEntry['$properties'][string] = {
        $type: p.cdf_type as CDFComponentEntry['$properties'][string]['$type'],
        $category: p.cdf_category as CDFComponentEntry['$properties'][string]['$category'],
      };
      if (p.required) propDef.$required = true;
      const isTokenProp = p.cdf_type === 'token' && p.cdf_category === 'design';
      const defaultReference = p.default_value;
      const resolvedDefault =
        isTokenProp && p.cdf_token_kind !== null && defaultReference !== null
          ? resolvedDefaultPaths[defaultReference]
          : undefined;
      const compatibleResolvedDefault =
        resolvedDefault !== undefined && tokenTypeByPath.get(resolvedDefault) === p.cdf_token_kind
          ? resolvedDefault
          : undefined;
      if (p.default_value !== null) {
        if (p.cdf_type === 'boolean') {
          propDef.$default = p.default_value === 'true';
        } else {
          propDef.$default = compatibleResolvedDefault ?? p.default_value;
        }
      }
      if (p.description !== null) propDef.$description = p.description;
      // A token prop's options list is design token paths, written below. Its
      // extracted variant names stay in the session as scoping input only.
      if (!isTokenProp && av && av.length > 0) propDef.$values = av.map((v) => v.value);
      if (p.cdf_token_kind !== null) propDef['$token.kind'] = p.cdf_token_kind;
      if (isTokenProp) {
        const allowed = toTokenPaths(tokenPathsByProp.get(`${component_id}::${p.name}`));
        if (allowed !== undefined && allowed.length > 0) propDef['$token.allowed'] = allowed;
      }
      $properties[p.name] = propDef;
    }

    const compSlots = slotsByComponent.get(component_id) ?? [];
    const $slots: CDFComponentEntry['$slots'] = {};
    for (const s of compSlots) {
      if (!s.name.trim()) continue;
      const ac = allowedComponentsBySlot.get(`${component_id}::${s.name}`);
      const slotDef: NonNullable<CDFComponentEntry['$slots']>[string] = {};
      if (s.description !== null) slotDef.$description = s.description;
      if (s.required) slotDef.$required = true;
      if (ac && ac.length > 0) slotDef.$allowedComponents = ac.map((v) => v.allowed_component);
      $slots[s.name] = slotDef;
    }

    const entry: CDFComponentEntry = { $type: 'component', $properties };
    if (description !== null) entry.$description = description;
    if (Object.keys($slots).length > 0) entry.$slots = $slots;
    return { key: name, entry };
  });
}

export function getScopeComponents(db: DatabaseSync, sessionId: string): ScopeComponentRow[] {
  const rows = db
    .prepare(
      `SELECT name, component_id, status, reject_reason, review_reasons, needs_review FROM raw_components
       WHERE session_id = ? AND status IN ('extracted', 'accepted', 'rejected')
       ORDER BY name`,
    )
    .all(sessionId)
    .map((row) => ({
      name: String(row.name),
      component_id: String(row.component_id),
      status: String(row.status),
      reject_reason: row.reject_reason === null ? null : String(row.reject_reason),
      review_reasons: String(row.review_reasons ?? '[]'),
      needs_review: Number(row.needs_review ?? 0),
    }));

  if (rows.length === 0) return [];

  const slotRows = db
    .prepare(
      `SELECT component_id, name, position
       FROM raw_slots WHERE session_id = ? ORDER BY component_id, position`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      name: String(row.name),
      position: Number(row.position),
    }));
  const allowedRows = db
    .prepare(
      `SELECT component_id, slot_name, position, allowed_component
       FROM raw_slot_allowed_components WHERE session_id = ? ORDER BY component_id, slot_name, position`,
    )
    .all(sessionId)
    .map((row) => ({
      component_id: String(row.component_id),
      slot_name: String(row.slot_name),
      position: Number(row.position),
      allowed_component: String(row.allowed_component),
    }));

  const slotsByComponent = indexRowsByKey(slotRows, (s) => s.component_id);
  const allowedBySlot = indexRowsByKey(allowedRows, (a) => `${a.component_id}::${a.slot_name}`);

  return rows.map((r) => {
    const reviewReasons = parseReviewReasons(r.review_reasons);
    const nonAuthorableReason = reviewReasons.find((reason) => reason.startsWith('non-authorable:'));

    return {
      name: r.name,
      componentId: r.component_id,
      aiDecision: r.status === 'accepted' ? 'accepted' : r.status === 'rejected' ? 'rejected' : null,
      aiReason: r.reject_reason ?? nonAuthorableReason?.slice('non-authorable:'.length) ?? null,
      needsReview: Boolean(r.needs_review),
      slots: (slotsByComponent.get(r.component_id) ?? []).map((s) => ({
        name: s.name,
        allowedComponents: (allowedBySlot.get(`${r.component_id}::${s.name}`) ?? []).map((a) => a.allowed_component),
      })),
    };
  });
}

export function getComponentRationale(
  db: DatabaseSync,
  sessionId: string,
  componentName: string,
): ComponentRationale | null {
  const compRow = db
    .prepare(
      `SELECT component_id, name, description, component_description_rationale, props_rationale, slots_rationale
       FROM raw_components WHERE session_id = ? AND name = ?`,
    )
    .get(sessionId, componentName);
  if (!compRow) return null;
  const componentId = String(compRow.component_id);

  const propRows = db
    .prepare(
      `SELECT name, cdf_category, category, description, rationale FROM raw_props
       WHERE session_id = ? AND component_id = ? ORDER BY position`,
    )
    .all(sessionId, componentId)
    .map((row) => ({
      name: String(row.name),
      cdf_category: row.cdf_category === null ? null : String(row.cdf_category),
      category: row.category === null ? null : String(row.category),
      description: row.description === null ? null : String(row.description),
      rationale: row.rationale === null ? null : String(row.rationale),
    }));

  const slotRows = db
    .prepare(
      `SELECT name, description, rationale FROM raw_slots
       WHERE session_id = ? AND component_id = ? ORDER BY position`,
    )
    .all(sessionId, componentId)
    .map((row) => ({
      name: String(row.name),
      description: row.description === null ? null : String(row.description),
      rationale: row.rationale === null ? null : String(row.rationale),
    }));

  return {
    name: String(compRow.name),
    description: compRow.description === null ? null : String(compRow.description),
    descriptionRationale:
      compRow.component_description_rationale === null ? null : String(compRow.component_description_rationale),
    propsRationale: compRow.props_rationale === null ? null : String(compRow.props_rationale),
    slotsRationale: compRow.slots_rationale === null ? null : String(compRow.slots_rationale),
    props: propRows.map((p) => ({
      name: p.name,
      category: p.cdf_category ?? p.category ?? null,
      description: p.description,
      rationale: p.rationale,
    })),
    slots: slotRows.map((s) => ({
      name: s.name,
      description: s.description,
      rationale: s.rationale,
    })),
  };
}

export function getComponentIdByName(db: DatabaseSync, sessionId: string, componentName: string): string | null {
  const row = db
    .prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?')
    .get(sessionId, componentName);
  return row ? String(row.component_id) : null;
}

export function getSlotDefaultsForComponent(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
): Map<string, number> {
  const rows = db
    .prepare('SELECT name, is_default FROM raw_slots WHERE session_id = ? AND component_id = ?')
    .all(sessionId, componentId)
    .map((row) => ({ name: String(row.name), is_default: Number(row.is_default) }));
  return new Map(rows.map((r) => [r.name, r.is_default]));
}

import type { DatabaseSync } from 'node:sqlite';
import type { MapTokenPropCall } from '@contentful/experience-design-system-generation';
import { replaceRawPropTokenPaths } from '../session/db.js';

export interface ApplyMapTokenPropCallsResult {
  applied: number;
  warnings: string[];
}

/**
 * Applies parsed `map_token_prop` calls to the session database. Each call is
 * validated against session state — unlike parseMapTokenPropToolCallLines,
 * which only checks the call's own shape — before any write happens.
 */
export function applyMapTokenPropCalls(
  db: DatabaseSync,
  sessionId: string,
  calls: MapTokenPropCall[],
  incomingWarnings: string[],
): ApplyMapTokenPropCallsResult {
  const warnings = [...incomingWarnings];
  let applied = 0;

  const findComponent = db.prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?');
  const findProp = db.prepare(
    'SELECT cdf_type, cdf_category FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?',
  );
  const findAllowedValues = db.prepare(
    'SELECT value FROM raw_prop_allowed_values WHERE session_id = ? AND component_id = ? AND prop_name = ?',
  );

  for (const call of calls) {
    const component = findComponent.get(sessionId, call.component) as { component_id: string } | undefined;
    if (!component) {
      warnings.push(`map_token_prop: unknown component '${call.component}' — skipped`);
      continue;
    }

    const prop = findProp.get(sessionId, component.component_id, call.prop) as
      | { cdf_type: string | null; cdf_category: string | null }
      | undefined;
    if (!prop) {
      warnings.push(`map_token_prop '${call.component}.${call.prop}': unknown prop — skipped`);
      continue;
    }
    if (prop.cdf_type !== 'token' || prop.cdf_category !== 'design') {
      warnings.push(
        `map_token_prop '${call.component}.${call.prop}': target is not a design-category token prop — skipped`,
      );
      continue;
    }

    const validValues = new Set(
      (findAllowedValues.all(sessionId, component.component_id, call.prop) as Array<{ value: string }>).map(
        (r) => r.value,
      ),
    );

    const filteredSets: string[] = [];
    for (const value of call.token_sets) {
      if (validValues.has(value)) {
        filteredSets.push(value);
      } else {
        warnings.push(`map_token_prop '${call.component}.${call.prop}': dropped unknown value '${value}'`);
      }
    }

    if (filteredSets.length === 0) {
      warnings.push(`map_token_prop '${call.component}.${call.prop}': no valid token_sets remain — skipped`);
      continue;
    }

    let filteredAllowed: string[] | undefined;
    if (call.token_allowed !== undefined) {
      filteredAllowed = [];
      for (const value of call.token_allowed) {
        if (validValues.has(value)) {
          filteredAllowed.push(value);
        } else {
          warnings.push(`map_token_prop '${call.component}.${call.prop}': dropped unknown value '${value}'`);
        }
      }

      if (!filteredAllowed.every((value) => filteredSets.includes(value))) {
        warnings.push(
          `map_token_prop '${call.component}.${call.prop}': token_allowed is not a subset of token_sets — skipped`,
        );
        continue;
      }
    }

    replaceRawPropTokenPaths(db, sessionId, component.component_id, call.prop, 'set', filteredSets);
    if (filteredAllowed !== undefined) {
      replaceRawPropTokenPaths(db, sessionId, component.component_id, call.prop, 'allowed', filteredAllowed);
    }
    applied++;
  }

  return { applied, warnings };
}

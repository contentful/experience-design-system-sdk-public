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

  const validTokenPaths = new Set(
    (db.prepare('SELECT path FROM raw_tokens WHERE session_id = ?').all(sessionId) as Array<{ path: string }>).map(
      (r) => r.path,
    ),
  );

  const findComponent = db.prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?');
  const findProp = db.prepare(
    'SELECT cdf_type, cdf_category FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?',
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

    const filteredSets: string[] = [];
    for (const path of call.token_sets) {
      if (validTokenPaths.has(path)) {
        filteredSets.push(path);
      } else {
        warnings.push(`map_token_prop '${call.component}.${call.prop}': dropped unknown token path '${path}'`);
      }
    }

    if (filteredSets.length === 0) {
      warnings.push(`map_token_prop '${call.component}.${call.prop}': no valid token_sets remain — skipped`);
      continue;
    }

    let filteredAllowed: string[] | undefined;
    if (call.token_allowed !== undefined) {
      filteredAllowed = [];
      for (const path of call.token_allowed) {
        if (validTokenPaths.has(path)) {
          filteredAllowed.push(path);
        } else {
          warnings.push(`map_token_prop '${call.component}.${call.prop}': dropped unknown token path '${path}'`);
        }
      }

      if (!filteredAllowed.every((path) => filteredSets.includes(path))) {
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

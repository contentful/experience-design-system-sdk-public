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

  // Keyed by token type: a restriction may only name tokens of the target
  // property's own $token.kind. Checking against every path in the session
  // would let a dimension token land on a colour property, which then fails
  // CDF validation with no obvious way back for whoever runs the pipeline.
  const tokenTypeByPath = new Map(
    (
      db.prepare('SELECT path, type FROM raw_tokens WHERE session_id = ?').all(sessionId) as Array<{
        path: string;
        type: string;
      }>
    ).map((r) => [r.path, r.type]),
  );

  const findComponent = db.prepare('SELECT component_id FROM raw_components WHERE session_id = ? AND name = ?');
  const findProp = db.prepare(
    'SELECT cdf_type, cdf_category, cdf_token_kind FROM raw_props WHERE session_id = ? AND component_id = ? AND name = ?',
  );

  for (const call of calls) {
    const component = findComponent.get(sessionId, call.component) as { component_id: string } | undefined;
    if (!component) {
      warnings.push(`map_token_prop: unknown component '${call.component}' — skipped`);
      continue;
    }

    const prop = findProp.get(sessionId, component.component_id, call.prop) as
      | { cdf_type: string | null; cdf_category: string | null; cdf_token_kind: string | null }
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

    const existing = db
      .prepare(
        `SELECT COUNT(*) AS count FROM raw_prop_token_paths
          WHERE session_id = ? AND component_id = ? AND prop_name = ? AND kind = 'allowed'`,
      )
      .get(sessionId, component.component_id, call.prop) as { count: number };
    if (existing.count > 0) {
      warnings.push(
        `map_token_prop '${call.component}.${call.prop}': already bound from source evidence — skipped`,
      );
      continue;
    }

    const filteredAllowed: string[] = [];
    for (const path of call.token_allowed) {
      const tokenType = tokenTypeByPath.get(path);
      if (tokenType === undefined) {
        warnings.push(`map_token_prop '${call.component}.${call.prop}': dropped unknown token path '${path}'`);
      } else if (prop.cdf_token_kind !== null && tokenType !== prop.cdf_token_kind) {
        warnings.push(
          `map_token_prop '${call.component}.${call.prop}': dropped '${path}' — it is a ${tokenType} token, but the property's $token.kind is ${prop.cdf_token_kind}`,
        );
      } else {
        filteredAllowed.push(path);
      }
    }

    if (filteredAllowed.length === 0) {
      warnings.push(`map_token_prop '${call.component}.${call.prop}': no valid token_allowed remain — skipped`);
      continue;
    }

    replaceRawPropTokenPaths(db, sessionId, component.component_id, call.prop, 'allowed', filteredAllowed);
    applied++;
  }

  return { applied, warnings };
}

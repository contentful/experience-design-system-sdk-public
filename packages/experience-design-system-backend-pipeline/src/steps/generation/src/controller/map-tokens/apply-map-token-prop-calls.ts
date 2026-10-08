import type { DatabaseSync } from 'node:sqlite';
import type { MapTokenPropCall } from '../../../../../agents/types/tool-calls.js';
import { replaceRawPropTokenPaths } from '../../../../../persistence/session/services/tokens/replace-raw-prop-token-paths.js';
import { filterAllowedPaths } from '../../helpers/map-tokens/filter-allowed-paths.js';
import { isPropReviewed } from '../../helpers/map-tokens/is-prop-reviewed.js';
import { loadTokenTypeByPath } from '../../helpers/map-tokens/load-token-type-by-path.js';
import type { ApplyMapTokenPropCallsResult } from '../../types/map-tokens.js';

/**
 * Apply parsed `map_token_prop` calls to the session database. Each call is
 * validated against session state — unlike the parser, which only checks the
 * call's own shape — before any write happens.
 */
export function applyMapTokenPropCalls(
  db: DatabaseSync,
  sessionId: string,
  calls: MapTokenPropCall[],
  incomingWarnings: string[],
): ApplyMapTokenPropCallsResult {
  const warnings = [...incomingWarnings];
  let applied = 0;

  const tokenTypeByPath = loadTokenTypeByPath(db, sessionId);

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

    if (isPropReviewed(db, sessionId, component.component_id, call.prop)) {
      warnings.push(
        `map_token_prop '${call.component}.${call.prop}': a reviewer already set this restriction — skipped`,
      );
      continue;
    }

    const filteredAllowed = filterAllowedPaths({
      component: call.component,
      prop: call.prop,
      tokenAllowed: call.token_allowed,
      tokenTypeByPath,
      propTokenKind: prop.cdf_token_kind,
      warnings,
    });

    if (filteredAllowed.length === 0) {
      warnings.push(`map_token_prop '${call.component}.${call.prop}': no valid token_allowed remain — skipped`);
      continue;
    }

    replaceRawPropTokenPaths(db, sessionId, component.component_id, call.prop, filteredAllowed, 'agent');
    applied++;
  }

  return { applied, warnings };
}

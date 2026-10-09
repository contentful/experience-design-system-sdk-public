import type { DatabaseSync } from 'node:sqlite';

export function loadRawDefaults(
  db: DatabaseSync,
  sessionId: string,
): Array<{ default_reference: string; cdf_token_kind: string | null }> {
  return db
    .prepare(
      `SELECT rp.default_value AS default_reference, rp.cdf_token_kind
       FROM raw_props rp
       JOIN raw_components rc ON rc.session_id = rp.session_id AND rc.component_id = rp.component_id
       WHERE rp.session_id = ? AND rc.status = 'generated'
         AND rp.cdf_type = 'token' AND rp.cdf_category = 'design'
         AND rp.default_value IS NOT NULL`,
    )
    .all(sessionId) as Array<{ default_reference: string; cdf_token_kind: string | null }>;
}

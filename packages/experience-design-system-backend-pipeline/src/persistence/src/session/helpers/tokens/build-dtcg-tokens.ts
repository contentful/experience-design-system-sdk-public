import type { DTCGTokenEntry } from '../../../../../steps/shared/index.js';
import type { TokenRow } from './build-dtcg-groups.js';

export function buildDtcgTokens(tokenRows: TokenRow[]): DTCGTokenEntry[] {
  return tokenRows.map((r) => {
    const t: DTCGTokenEntry = {
      path: r.path,
      $type: r.type as DTCGTokenEntry['$type'],
      $value: JSON.parse(r.value) as unknown,
    };
    if (r.description !== null) t.$description = r.description;
    return t;
  });
}

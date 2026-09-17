import type { DTCGTokenGroup } from '@contentful/experience-design-system-types';

export interface GroupRow {
  path: string;
  description: string | null;
}

export interface TokenRow {
  path: string;
  type: string;
  value: string;
  description: string | null;
}

export function buildDtcgGroups(groupRows: GroupRow[], tokenRows: TokenRow[]): DTCGTokenGroup[] {
  return groupRows.map((r) => {
    const prefix = `${r.path}.`;
    const tokenIds = tokenRows
      .filter((t) => t.path.startsWith(prefix) && !t.path.slice(prefix.length).includes('.'))
      .map((t) => t.path);
    const g: DTCGTokenGroup = { path: r.path, tokenIds };
    if (r.description !== null) g.$description = r.description;
    return g;
  });
}

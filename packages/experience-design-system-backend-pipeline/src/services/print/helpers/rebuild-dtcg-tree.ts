import type { DTCGTokenGroupNode } from '../../../steps/shared/dtcg/types/types.js';

export function rebuildDTCGTree(
  groups: Array<{ path: string; $description?: string }>,
  tokens: Array<{ path: string; $type: string; $value: unknown; $description?: string }>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const group of groups) {
    const segments = group.path.split('.');
    let node = root;
    for (const seg of segments) {
      if (typeof node[seg] !== 'object' || node[seg] === null) {
        node[seg] = {};
      }
      node = node[seg] as Record<string, unknown>;
    }
    if (group.$description) {
      (node as Record<string, unknown>)['$description'] = group.$description;
    }
  }

  for (const token of tokens) {
    const segments = token.path.split('.');
    const leafKey = segments[segments.length - 1]!;
    const parentSegments = segments.slice(0, -1);

    let node = root;
    for (const seg of parentSegments) {
      if (typeof node[seg] !== 'object' || node[seg] === null) {
        node[seg] = {};
      }
      node = node[seg] as Record<string, unknown>;
    }

    const leaf: Record<string, unknown> = { $type: token.$type, $value: token.$value };
    if (token.$description) leaf['$description'] = token.$description;
    (node as DTCGTokenGroupNode)[leafKey] = leaf as DTCGTokenGroupNode;
  }

  return root;
}

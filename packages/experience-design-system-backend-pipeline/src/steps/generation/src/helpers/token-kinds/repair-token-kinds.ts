import type { CDFComponentEntry, CDFPropertyDefinition, DTCGTokenEntry } from '../../../../shared/index.js';

// The agent sometimes marks a property as a design token without saying which kind of token. The API rejects a token
// property with no kind, and only when the definition is applied, after the preview has already passed. So the kind is
// worked out here from the token catalog, and a property whose kind cannot be told becomes a plain string instead of an
// invalid token.

/** The one token type shared by every token with the property's name in its path, or undefined when there is not exactly one. */
function inferTokenKind(propName: string, tokens: DTCGTokenEntry[]): string | undefined {
  const name = propName.toLowerCase();
  const kinds = new Set(
    tokens.filter((token) => token.path.toLowerCase().split('.').includes(name)).map((token) => token.$type),
  );
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

/** Gives every token property a `$token.kind`. Says what it did through `note`, so a repair is never silent. */
export function repairTokenKinds(
  entry: CDFComponentEntry,
  componentName: string,
  tokens: DTCGTokenEntry[] = [],
  note?: (message: string) => void,
): CDFComponentEntry {
  const properties: Record<string, CDFPropertyDefinition> = { ...entry.$properties };
  let repaired = false;

  for (const [name, prop] of Object.entries(entry.$properties)) {
    if (prop.$type !== 'token' || prop['$token.kind']) continue;
    repaired = true;
    const kind = inferTokenKind(name, tokens);
    if (kind) {
      properties[name] = { ...prop, '$token.kind': kind };
      note?.(`${componentName}.${name}: the agent gave no token kind, so "${kind}" was taken from the token file`);
    } else {
      const plain: CDFPropertyDefinition = { ...prop, $type: 'string' };
      delete plain['$token.allowed'];
      properties[name] = plain;
      note?.(
        `${componentName}.${name}: the agent gave no token kind and none could be told, so it is a string property`,
      );
    }
  }

  return repaired ? { ...entry, $properties: properties } : entry;
}

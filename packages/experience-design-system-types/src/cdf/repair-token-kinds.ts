import type { CDFComponentEntry, CDFPropertyDefinition, CDFTokenEntry } from './types.js';

// When the generation agent cannot resolve the token a property is bound to, its instructions are to keep the property a
// token, leave the kind out and say so in the description ("Resolving token_kind" in generate-components.md). The pipeline
// keeps such a property as it is: a token property with no kind is a normal state while components are generated and
// mapped. The API rejects it, though, and only when the definition is applied, after the preview has already passed. So
// the kind is settled when the document is built, from the tokens that go into it, and a property whose kind cannot be
// told becomes a plain string instead of an invalid token.

type Tokens = Array<{ path: string; entry: CDFTokenEntry }>;

/** The warning the agent writes into a description when it left the kind out. Once the kind is settled it is stale, and a description is customer-facing text. */
const UNRESOLVED_WARNING = /\s*WARNING: token_kind unknown[^\n]*/;

/**
 * The token's own type if the property's default names a token that exists, which is the token the property is bound to.
 * Failing that, the one type shared by every token with the property's name in its path, or undefined when there is not
 * exactly one.
 */
function inferTokenKind(propName: string, prop: CDFPropertyDefinition, tokens: Tokens): string | undefined {
  const bound = typeof prop.$default === 'string' ? tokens.find(({ path }) => path === prop.$default) : undefined;
  if (bound) return bound.entry.$type;

  const name = propName.toLowerCase();
  const kinds = new Set(
    tokens.filter(({ path }) => path.toLowerCase().split('.').includes(name)).map(({ entry }) => entry.$type),
  );
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

function withoutWarning(prop: CDFPropertyDefinition): CDFPropertyDefinition {
  if (prop.$description === undefined) return prop;
  const description = prop.$description.replace(UNRESOLVED_WARNING, '').trim();
  const { $description: _stale, ...rest } = prop;
  return description ? { ...rest, $description: description } : rest;
}

/** Gives every token property a `$token.kind`. Says what it did through `note`, so a repair is never silent. */
export function repairTokenKinds(
  entry: CDFComponentEntry,
  componentKey: string,
  tokens: Tokens,
  note?: (message: string) => void,
): CDFComponentEntry {
  const properties: Record<string, CDFPropertyDefinition> = { ...entry.$properties };
  let repaired = false;

  for (const [name, prop] of Object.entries(entry.$properties)) {
    if (prop.$type !== 'token' || prop['$token.kind']) continue;
    repaired = true;
    const kind = inferTokenKind(name, prop, tokens);
    if (kind) {
      properties[name] = { ...withoutWarning(prop), '$token.kind': kind };
      note?.(`${componentKey}.${name} had no token kind, so "${kind}" was taken from the token file`);
    } else {
      // Its default and allowed list are token paths, which mean nothing on a string property.
      const plain: CDFPropertyDefinition = { ...withoutWarning(prop), $type: 'string' };
      delete plain['$token.allowed'];
      delete plain.$default;
      properties[name] = plain;
      note?.(`${componentKey}.${name} had no token kind and none could be told, so it was saved as a string property`);
    }
  }

  return repaired ? { ...entry, $properties: properties } : entry;
}

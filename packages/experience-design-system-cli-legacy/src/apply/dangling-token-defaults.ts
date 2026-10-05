import { parseCDFComponents, type CDFDocument } from '@contentful/experience-design-system-types';

export interface DroppedTokenDefault {
  component: string;
  property: string;
  token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Contentful turns a token property's `$default` into a link to a design token and rejects the
 * whole component when that token does not exist ("unknown DesignToken ID"). This removes the
 * default from any token property whose token is neither defined in the CDF itself nor already in
 * the target environment, so the component can still be created. The input is not modified.
 */
export function dropDanglingTokenDefaults(
  cdf: CDFDocument,
  existingTokenIds: ReadonlySet<string>,
): { cdf: CDFDocument; dropped: DroppedTokenDefault[] } {
  const known = new Set(existingTokenIds);
  for (const { path } of parseCDFComponents(cdf).tokens) known.add(path);

  const copy = structuredClone(cdf);
  const dropped: DroppedTokenDefault[] = [];

  const walk = (node: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('$') || !isRecord(value)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const properties = value['$properties'];
      if (value['$type'] === 'component' && isRecord(properties)) {
        for (const [name, property] of Object.entries(properties)) {
          if (!isRecord(property) || property['$type'] !== 'token') continue;
          const reference = property['$default'];
          if (typeof reference === 'string' && reference !== '' && !known.has(reference)) {
            delete property['$default'];
            dropped.push({ component: path, property: name, token: reference });
          }
        }
      } else {
        walk(value, path);
      }
    }
  };
  walk(copy, '');

  return { cdf: copy, dropped };
}

export function describeDroppedTokenDefaults(dropped: DroppedTokenDefault[]): string[] {
  return dropped.map(
    ({ component, property, token }) =>
      `${component}.${property}: default "${token}" left out — that design token does not exist in this environment`,
  );
}

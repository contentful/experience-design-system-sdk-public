export type CdfCategory = 'content' | 'design' | 'state';

const VALID_CATEGORIES: readonly CdfCategory[] = ['content', 'design', 'state'];

/**
 * Translate a Contentful CMA type name into the CLI's internal CDF type name.
 * The vocabularies overlap but differ (e.g. Contentful "symbol" → CDF "enum",
 * Contentful "text" → CDF "string"). Unknown inputs default to "string".
 */
export function mapContentfulTypeToCdfType(contentfulType: string): string {
  switch (contentfulType.toLowerCase()) {
    case 'string':
    case 'text':
      return 'string';
    case 'richtext':
      return 'richtext';
    case 'media':
      return 'media';
    case 'link':
      return 'link';
    case 'enum':
    case 'symbol':
      return 'enum';
    case 'token':
      return 'token';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

/**
 * Decide which CDF category (`content` | `design` | `state`) a prop belongs to.
 *
 * Trusts a valid Contentful-provided category when present. Otherwise, falls
 * back to per-component prop-name classification (contentProperties /
 * designProperties from the same Contentful response), defaulting to `state`.
 */
export function resolveCdfCategory(
  contentfulCategory: string | null | undefined,
  propName: string,
  contentProps: Set<string>,
  designProps: Set<string>,
): CdfCategory {
  if (contentfulCategory && VALID_CATEGORIES.includes(contentfulCategory as CdfCategory)) {
    return contentfulCategory as CdfCategory;
  }
  if (contentProps.has(propName)) return 'content';
  if (designProps.has(propName)) return 'design';
  return 'state';
}

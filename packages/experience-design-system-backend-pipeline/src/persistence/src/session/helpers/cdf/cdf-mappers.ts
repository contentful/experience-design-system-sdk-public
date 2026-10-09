export type CdfCategory = 'content' | 'design' | 'state';

const VALID_CATEGORIES: readonly CdfCategory[] = ['content', 'design', 'state'];

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

export type CdfCategory = 'content' | 'design' | 'state';

const VALID_CATEGORIES: readonly CdfCategory[] = ['content', 'design', 'state'];

export function mapServerTypeToCdfType(serverType: string): string {
  switch (serverType.toLowerCase()) {
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
  serverCategory: string | null | undefined,
  propName: string,
  contentProps: Set<string>,
  designProps: Set<string>,
): CdfCategory {
  if (serverCategory && VALID_CATEGORIES.includes(serverCategory as CdfCategory)) {
    return serverCategory as CdfCategory;
  }
  if (contentProps.has(propName)) return 'content';
  if (designProps.has(propName)) return 'design';
  return 'state';
}

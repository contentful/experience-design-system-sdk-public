export const CDF_PROPERTY_TYPES = [
  'string',
  'richtext',
  'number',
  'media',
  'link',
  'enum',
  'token',
  'boolean',
] as const;

export const CDF_PROPERTY_CATEGORIES = ['content', 'design', 'state', 'unattached'] as const;

// Richer field vocabulary for the property-contract validators. Dormant:
// `CDF_PROPERTY_TYPES` still drives the live CDF schema, review editor and
// server contract. The two converge (and `enum` is retired in favour of
// `$values`) when generation switches to the property contract. See INTEG-4927.
export const CDF_FIELD_TYPES = [
  'string',
  'richtext',
  'number',
  'media',
  'link',
  'token',
  'boolean',
  'array',
  'record',
  'Integer',
  'DateTime',
  'Literal',
  'RichText',
  'JSON',
  'ResourceLink',
  'DiscriminatedUnion',
] as const;

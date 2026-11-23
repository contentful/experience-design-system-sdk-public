import { describe, expect, it } from 'vitest';
import { CDF_PROPERTY_TYPES } from '@contentful/experience-design-system-types';
import { mapContentfulTypeToCdfType } from '../src/session/helpers/cdf/cdf-mappers.js';

describe('mapContentfulTypeToCdfType', () => {
  it.each(['Enum', 'enum', 'Symbol'])('reads a published %s property as a string', (type) => {
    expect(mapContentfulTypeToCdfType(type)).toBe('string');
  });

  it.each(['String', 'Text', 'RichText', 'Media', 'Link', 'Token', 'Boolean', 'Location'])(
    'never produces a type outside the CDF vocabulary for %s',
    (type) => {
      expect(CDF_PROPERTY_TYPES).toContain(mapContentfulTypeToCdfType(type));
    },
  );
});

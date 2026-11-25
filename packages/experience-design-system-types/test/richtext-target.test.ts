import { describe, expect, it } from 'vitest';
import { cdfToTarget } from '../src/index.js';

describe('cdfToTarget richtext', () => {
  it('maps content richtext to RichText without a default', () => {
    expect(cdfToTarget({ $type: 'richtext', $category: 'content', $required: true, $default: '<p>Hi</p>' })).toEqual({
      type: 'RichText',
      required: true,
    });
  });

  it('keeps design, state and uncategorized richtext as String with its default', () => {
    for (const $category of ['design', 'state', undefined] as const)
      expect(cdfToTarget({ $type: 'richtext', $category, $default: 'Hi' })).toEqual({
        type: 'String',
        defaultValue: 'Hi',
      });
  });

  it('keeps the default on explicit RichText so validation can reject it', () => {
    expect(cdfToTarget({ $type: 'RichText', $category: 'content', $default: 'Hi' })).toEqual({
      type: 'RichText',
      defaultValue: 'Hi',
    });
  });
});

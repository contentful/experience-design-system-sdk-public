import { describe, expect, it } from 'vitest';
import { extractAllowedComponentsFromTypeText } from '../src/extract/evidence/allowed-components.js';
import { parseImportedNames } from '../src/extract/evidence/source-evidence.js';
import { isReactNodeType, shouldBeSlot } from '../src/extract/evidence/slot-evidence.js';

describe('evidence boundaries', () => {
  it('keeps structural slot evidence separate from content-name classification', () => {
    expect(shouldBeSlot('icon', 'ReactNode')).toBe(true);
    expect(shouldBeSlot('title', 'ReactNode')).toBe(false);
    expect(isReactNodeType('ReactNode | undefined')).toBe(true);
  });

  it('resolves only known allowed components from declared type evidence', () => {
    const allowed = extractAllowedComponentsFromTypeText('ReactElement<ButtonProps> | ReactElement<MissingProps>', {
      propsToComponent: new Map([['ButtonProps', 'Button']]),
      componentNames: new Set(['Button']),
    });

    expect(allowed).toEqual(['Button']);
    expect(
      extractAllowedComponentsFromTypeText('ReactNode', {
        propsToComponent: new Map(),
        componentNames: new Set(),
      }),
    ).toEqual([]);
  });

  it('parses imported names as source evidence and rejects empty clauses', () => {
    expect(parseImportedNames('React, { Button as PrimaryButton }')).toEqual(['React', 'Button']);
    expect(parseImportedNames('   ')).toEqual([]);
  });
});

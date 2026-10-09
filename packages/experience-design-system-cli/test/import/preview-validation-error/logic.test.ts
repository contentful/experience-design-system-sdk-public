import { describe, expect, it } from 'vitest';
import {
  contextText,
  failedComponentNames,
  formatErrorLine,
  matchedComponentNames,
  missingNote,
  skipLabel,
  type PreviewValidationError,
} from '../../../src/tui/import/steps/preview-validation-error/logic.js';

const SLOT: PreviewValidationError = {
  componentName: 'PageLink',
  path: 'manifest:components/PageLink/$slots/',
  message: 'Slot id must be a non-empty string',
};
const PROP: PreviewValidationError = {
  componentName: 'Button',
  path: 'manifest:components/Button/$properties/variant',
  message: 'variant required',
};

describe('component names', () => {
  it('lists each failed component once, in order', () => {
    expect(failedComponentNames([SLOT, PROP, { ...SLOT, message: 'again' }])).toEqual(['PageLink', 'Button']);
  });

  it('drops components the server named that are not in this session', () => {
    expect(matchedComponentNames([SLOT, PROP], ['Button'])).toEqual(['PageLink']);
    expect(matchedComponentNames([SLOT], ['PageLink'])).toEqual([]);
  });
});

describe('formatErrorLine', () => {
  it('shows the message with its component and path', () => {
    expect(formatErrorLine(PROP)).toBe(
      '- variant required (Component: Button; Path: manifest:components/Button/$properties/variant)',
    );
  });

  it('leaves out the path when the server gave none', () => {
    expect(formatErrorLine({ ...PROP, path: '' })).toBe('- variant required (Component: Button)');
  });
});

describe('missingNote', () => {
  it('is empty when nothing is missing', () => {
    expect(missingNote([])).toBe('');
  });

  it('uses the singular for one name and the plural for several', () => {
    expect(missingNote(['Phantom'])).toContain('1 component name from the server (Phantom) does not match');
    expect(missingNote(['A', 'B'])).toContain('2 component names from the server (A, B) do not match');
  });
});

describe('contextText', () => {
  it('counts failed components and appends the missing-name note', () => {
    expect(contextText([SLOT], [])).toContain('1 component failed server validation');
    expect(contextText([SLOT, PROP], ['Button'])).toContain('2 components failed server validation');
    expect(contextText([SLOT, PROP], ['Button'])).toContain('Button');
  });
});

describe('skipLabel', () => {
  it('names the component when one matches, counts when several do', () => {
    expect(skipLabel(['PageLink'])).toBe('Skip PageLink and retry');
    expect(skipLabel(['PageLink', 'Button'])).toBe('Skip 2 components and retry');
  });

  it('explains when there is nothing to skip', () => {
    expect(skipLabel([])).toBe('No matching components to skip');
  });
});

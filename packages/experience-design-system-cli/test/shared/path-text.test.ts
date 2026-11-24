import { describe, expect, it } from 'vitest';
import { cleanPathText, printable, stripControlCharacters } from '../../src/tui/shared/path-text.js';

describe('path text', () => {
  it('keeps an ordinary path as it is', () => {
    expect(cleanPathText('/Users/me/My Library/src')).toBe('/Users/me/My Library/src');
    expect(printable('/Users/me/My Library/src')).toBe('/Users/me/My Library/src');
  });

  it('drops a pasted carriage return, newline or tab and the surrounding whitespace', () => {
    expect(cleanPathText('  /Users/me/src/components\r')).toBe('/Users/me/src/components');
    expect(cleanPathText('/Users/me/src\r\n')).toBe('/Users/me/src');
    expect(cleanPathText('\t/Users/me/\x1b[31msrc')).toBe('/Users/me/[31msrc');
    expect(cleanPathText('\r\n\t ')).toBe('');
  });

  it('keeps spaces inside a value while it is being typed', () => {
    expect(stripControlCharacters('/Users/me/My \rLibrary ')).toBe('/Users/me/My Library ');
  });

  it('shows control characters as visible escapes so nothing overprints', () => {
    expect(printable('/a/theme.css\r/.contentful')).toBe('/a/theme.css\\r/.contentful');
    expect(printable('a\bb\tc\x1bd\x7f')).toBe('a\\x08b\\tc\\x1bd\\x7f');
  });

  it('keeps line breaks in a message, since they move to a new line and never overprint', () => {
    expect(printable('Could not save:\n/a/theme.css\r')).toBe('Could not save:\n/a/theme.css\\r');
  });
});

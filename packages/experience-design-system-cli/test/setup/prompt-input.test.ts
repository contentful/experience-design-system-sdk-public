import { describe, expect, it } from 'vitest';
import { splitPromptInput } from '../../src/setup/prompt-input.js';

describe('splitPromptInput', () => {
  it('treats a plain chunk as typed text that does not submit', () => {
    expect(splitPromptInput('demo-space')).toEqual({ text: 'demo-space', submitted: false });
  });

  it('submits when a chunk carries a trailing carriage return', () => {
    expect(splitPromptInput('demo-space\r')).toEqual({ text: 'demo-space', submitted: true });
  });

  it('submits when a chunk carries a trailing newline', () => {
    expect(splitPromptInput('demo-space\n')).toEqual({ text: 'demo-space', submitted: true });
  });

  it('submits a bare newline with no text', () => {
    expect(splitPromptInput('\r')).toEqual({ text: '', submitted: true });
  });

  it('keeps only the first line of a multi-line paste', () => {
    expect(splitPromptInput('first\rsecond\rthird')).toEqual({ text: 'first', submitted: true });
  });

  it('strips the bracketed-paste markers a terminal wraps a paste in', () => {
    expect(splitPromptInput('\x1b[200~token\x1b[201~')).toEqual({ text: 'token', submitted: false });
  });

  it('submits a bracketed paste that carries its own newline', () => {
    expect(splitPromptInput('\x1b[200~token\x1b[201~\r')).toEqual({ text: 'token', submitted: true });
  });

  it('preserves a pasted token verbatim', () => {
    const token = 'CFPAT-abc123_XY-z.9';
    expect(splitPromptInput(`${token}\r`)).toEqual({ text: token, submitted: true });
  });
});

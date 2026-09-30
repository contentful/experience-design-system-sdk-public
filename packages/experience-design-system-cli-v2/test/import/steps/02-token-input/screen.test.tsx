import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TokenInputScreen } from '../../../../src/tui/import/steps/02-token-input/screen.js';

const ESC = '\u001B';
const ENTER = '\r';
const BACKSPACE = '\u007F';

let dir: string;
let tokensFile: string;
let subDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'token-screen-'));
  tokensFile = join(dir, 'tokens.json');
  subDir = join(dir, 'folder');
  writeFileSync(tokensFile, '{}');
  mkdirSync(subDir);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function plain(frame: string | undefined): string {
  return (frame ?? '').replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

async function type(stdin: { write: (data: string) => void }, text: string): Promise<void> {
  for (const char of text) {
    stdin.write(char);
    await flush();
  }
}

async function renderScreen() {
  const onConfirm = vi.fn();
  const onSkip = vi.fn();
  const onQuit = vi.fn();
  const instance = render(<TokenInputScreen onConfirm={onConfirm} onSkip={onSkip} onQuit={onQuit} />);
  await flush();
  return { ...instance, onConfirm, onSkip, onQuit };
}

describe('TokenInputScreen', () => {
  it('shows the heading, the prompt and the controls', async () => {
    const { lastFrame } = await renderScreen();

    const frame = plain(lastFrame());
    expect(frame).toContain('Design tokens');
    expect(frame).toContain('Token path');
    expect(frame).toContain('[Enter] Submit / Skip if empty');
    expect(frame).toContain('[s] Skip');
    expect(frame).toContain('[Esc/q] Back to menu');
  });

  it('keeps a path containing s and q as text, without skipping or quitting (regression: ~/styles/tokens.json)', async () => {
    const { stdin, lastFrame, onSkip, onQuit } = await renderScreen();
    await type(stdin, '~/styles/quiz.json');

    expect(onSkip).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain('~/styles/quiz.json');
  });

  it('skips on s from an empty field', async () => {
    const { stdin, onSkip } = await renderScreen();
    stdin.write('s');
    await flush();

    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('goes back on q from an empty field', async () => {
    const { stdin, onQuit } = await renderScreen();
    stdin.write('q');
    await flush();

    expect(onQuit).toHaveBeenCalledOnce();
  });

  it('goes back on escape, even with text in the field', async () => {
    const { stdin, onQuit } = await renderScreen();
    await type(stdin, 'abc');
    stdin.write(ESC);
    await flush();

    expect(onQuit).toHaveBeenCalledOnce();
  });

  it('skips on enter from an empty field', async () => {
    const { stdin, onSkip } = await renderScreen();
    stdin.write(ENTER);
    await flush();

    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('treats s as a shortcut again after backspacing to empty', async () => {
    const { stdin, onSkip } = await renderScreen();
    await type(stdin, 'a');
    stdin.write(BACKSPACE);
    await flush();
    stdin.write('s');
    await flush();

    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('confirms with the absolute path of an existing file', async () => {
    const { stdin, onConfirm } = await renderScreen();
    await type(stdin, tokensFile);
    stdin.write(ENTER);
    await flush();

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(tokensFile);
  });

  it('shows an error and does not confirm when the path does not exist', async () => {
    const { stdin, lastFrame, onConfirm } = await renderScreen();
    const missing = join(dir, 'missing.json');
    await type(stdin, missing);
    stdin.write(ENTER);
    await flush();

    expect(onConfirm).not.toHaveBeenCalled();
    // The long temp path wraps in the narrow test renderer, so assert on the parts that stay on one line.
    expect(plain(lastFrame())).toContain('Path not found');
    expect(plain(lastFrame())).toContain('Resolved to:');
  });

  it('shows an error and does not confirm when the path is a directory', async () => {
    const { stdin, lastFrame, onConfirm } = await renderScreen();
    await type(stdin, subDir);
    stdin.write(ENTER);
    await flush();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain("That's a directory");
  });

  it('clears the error as soon as the user edits the path', async () => {
    const { stdin, lastFrame } = await renderScreen();
    await type(stdin, join(dir, 'missing.json'));
    stdin.write(ENTER);
    await flush();
    stdin.write(BACKSPACE);
    await flush();

    expect(plain(lastFrame())).not.toContain('Path not found');
  });
});

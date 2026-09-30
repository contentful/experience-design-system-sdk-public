import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeScreen } from '../../../../src/tui/import/steps/01-welcome/screen.js';

const ESC = '\u001B';
const ENTER = '\r';

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

function renderWelcome() {
  const onContinue = vi.fn();
  const onQuit = vi.fn();
  const instance = render(<WelcomeScreen onContinue={onContinue} onQuit={onQuit} />);
  return { ...instance, onContinue, onQuit };
}

describe('WelcomeScreen', () => {
  it('shows the greeting, all five steps and the path prompt', async () => {
    const { lastFrame } = renderWelcome();
    await flush();

    const frame = plain(lastFrame());
    expect(frame).toContain("Let's import your design system into Contentful");
    for (let n = 1; n <= 5; n++) expect(frame).toContain(`Step ${n}`);
    expect(frame).toContain('Project path:');
    expect(frame).toContain('[Esc/q] Back to menu');
  });

  it('shows what the user types', async () => {
    const { stdin, lastFrame } = renderWelcome();
    await flush();
    await type(stdin, './src');

    expect(plain(lastFrame())).toContain('Project path: ./src');
  });

  it('continues with the trimmed path on enter', async () => {
    const { stdin, onContinue } = renderWelcome();
    await flush();
    await type(stdin, '  ./src ');
    stdin.write(ENTER);
    await flush();

    expect(onContinue).toHaveBeenCalledExactlyOnceWith('./src');
  });

  it('does not continue from an empty field', async () => {
    const { stdin, onContinue } = renderWelcome();
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onContinue).not.toHaveBeenCalled();
  });

  it('goes back on q from an empty field', async () => {
    const { stdin, onQuit } = renderWelcome();
    await flush();
    stdin.write('q');
    await flush();

    expect(onQuit).toHaveBeenCalledOnce();
  });

  it('keeps q as a letter once something is typed, and does not quit', async () => {
    const { stdin, lastFrame, onQuit } = renderWelcome();
    await flush();
    await type(stdin, 'src/quiz');

    expect(onQuit).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain('Project path: src/quiz');
  });

  it('goes back on escape', async () => {
    const { stdin, onQuit } = renderWelcome();
    await flush();
    stdin.write(ESC);
    await flush();

    expect(onQuit).toHaveBeenCalledOnce();
  });
});

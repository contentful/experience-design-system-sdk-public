import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathPrompt } from '../../../../../src/tui/import/steps/10-flow/screens/PathPrompt.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

const CLEAR = '\x04';
const TAB = '\t';
const ENTER = '\r';
const BACKSPACE = '\x7f';

describe('PathPrompt', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'path-prompt-'));
  });

  afterEach(() => {
    cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const open = (defaultPath: string) => {
    const onSubmit = vi.fn();
    const view = render(<PathPrompt defaultPath={defaultPath} onSubmit={onSubmit} onCancel={vi.fn()} />);
    const press = async (data: string): Promise<void> => {
      view.stdin.write(data);
      await tick();
    };
    return { onSubmit, press, frame: () => stripAnsi(view.lastFrame() ?? '') };
  };

  it('opens with the saved path ready to edit, so typing changes it without pressing Tab first', async () => {
    const { onSubmit, press } = open(join(dir, 'out'));
    await tick();

    await press(BACKSPACE);
    await press('2');
    await press(ENTER);

    expect(onSubmit).toHaveBeenCalledWith(join(dir, 'ou2'));
  });

  it('submits the saved path when Enter is pressed straight away', async () => {
    const { onSubmit, press } = open(join(dir, 'out'));
    await tick();

    await press(ENTER);

    expect(onSubmit).toHaveBeenCalledWith(join(dir, 'out'));
  });

  it('clears the whole path with Ctrl+D so a new one can be typed', async () => {
    const { onSubmit, press } = open(join(dir, 'out'));
    await tick();

    await press(CLEAR);
    await press(join(dir, 'elsewhere'));
    await press(ENTER);

    expect(onSubmit).toHaveBeenCalledWith(join(dir, 'elsewhere'));
  });

  it('shows an empty field after Ctrl+D and does not submit it', async () => {
    const { onSubmit, press, frame } = open(join(dir, 'out'));
    await tick();

    await press(CLEAR);
    expect(frame()).not.toContain(join(dir, 'out'));
    await press(ENTER);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('autocompletes the last segment with Tab and continues into a folder', async () => {
    mkdirSync(join(dir, 'components'));
    mkdirSync(join(dir, 'components', 'buttons'));
    writeFileSync(join(dir, 'config.json'), '{}');
    const { onSubmit, press, frame } = open(join(dir, 'out'));
    await tick();

    await press(CLEAR);
    await press(join(dir, 'com'));
    await press(TAB);
    expect(frame()).toContain(join(dir, 'components') + '/');

    await press('b');
    await press(TAB);
    await press(ENTER);

    expect(onSubmit).toHaveBeenCalledWith(join(dir, 'components', 'buttons'));
  });

  it('leaves the path alone when Tab has nothing to complete', async () => {
    const { onSubmit, press } = open(join(dir, 'zzz'));
    await tick();

    await press(TAB);
    await press(ENTER);

    expect(onSubmit).toHaveBeenCalledWith(join(dir, 'zzz'));
  });

  it('drops a carriage return pasted with the path instead of saving to a folder named with it', async () => {
    const { onSubmit, press, frame } = open(join(dir, 'out'));
    await tick();

    await press(CLEAR);
    await press(`${join(dir, 'pasted')}\r\n`);
    expect(frame()).not.toContain('\r');
    await press(ENTER);

    expect(onSubmit).toHaveBeenCalledWith(join(dir, 'pasted'));
  });

  it('never prints a control character from the saved path', async () => {
    const { onSubmit, press, frame } = open(`${join(dir, 'theme.css')}\r/.contentful`);
    await tick();

    expect(frame()).not.toContain('\r');
    expect(frame().replace(/[\s█]+/g, '')).toContain(`${join(dir, 'theme.css')}/.contentful`);
    await press(ENTER);

    expect(onSubmit).toHaveBeenCalledWith(join(dir, 'theme.css', '.contentful'));
  });

  it('lists only the keys it supports', async () => {
    const { frame } = open(join(dir, 'out'));
    await tick();

    expect(frame()).toContain('Enter');
    expect(frame()).toContain('Tab');
    expect(frame()).toContain('Autocomplete');
    expect(frame()).toContain('Ctrl+D');
    expect(frame()).toContain('Clear');
    expect(frame()).toContain('Esc');
  });
});

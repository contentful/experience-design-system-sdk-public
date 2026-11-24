import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectScreen } from '../../../../src/tui/settings/configuration/project/ProjectScreen.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('ProjectScreen', () => {
  let home: string;
  let work: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'eds-home-'));
    work = await mkdtemp(join(tmpdir(), 'eds-work-'));
    process.env['EDS_HOME'] = home;
  });

  afterEach(async () => {
    cleanup();
    delete process.env['EDS_HOME'];
    await rm(home, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  const writeConfig = (settings: Record<string, unknown>): Promise<void> =>
    writeFile(join(home, 'config.json'), JSON.stringify({ debugMode: { enabled: false }, ...settings }));

  const readConfig = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(join(home, 'config.json'), 'utf8')) as Record<string, unknown>;

  const open = async () => {
    const view = render(<ProjectScreen onDone={vi.fn()} />);
    const frame = (): string => stripAnsi(view.lastFrame() ?? '');
    await vi.waitFor(() => expect(frame()).toContain('Root Project Directory'));
    return { view, frame };
  };

  it('shows a saved path that ends in a carriage return as the clean path', async () => {
    await writeConfig({ defaultComponentDir: `${work}/src/components\r`, contentfulBaseDir: `${work}\r` });

    const { frame } = await open();

    expect(frame().replace(/\s+/g, '')).toContain(`${work}/src/components`);
    expect(frame()).not.toContain('\r');
  });

  it('prints a control character saved in any other setting as a visible escape', async () => {
    await writeConfig({ spaceId: 'space\r' });

    const { frame } = await open();

    expect(frame()).toContain('space\\r');
    expect(frame()).not.toContain('\r');
  });

  it('saves a cleaned base directory, so a legacy value recovers on the next save', async () => {
    await writeConfig({ contentfulBaseDir: `${work}\r` });
    const { view, frame } = await open();

    view.stdin.write('s');
    await vi.waitFor(() => expect(frame()).toContain('Project settings saved'));

    expect((await readConfig())['contentfulBaseDir']).toBe(work);
  });

  it('says when the saved base directory points to a file and refuses to save it', async () => {
    const file = join(work, 'theme.css');
    await writeFile(file, 'body {}');
    await writeConfig({ contentfulBaseDir: `${file}\r` });

    const { view, frame } = await open();
    expect(frame().replace(/\s+/g, ' ')).toContain(`but ${file} is a file`);

    view.stdin.write('s');
    await tick();

    expect(frame()).not.toContain('Project settings saved');
    expect(frame()).toContain('must be a folder');
    expect((await readConfig())['contentfulBaseDir']).toBe(`${file}\r`);
  });
});

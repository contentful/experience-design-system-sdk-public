import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from 'ink-testing-library';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { App } from '../../../../src/analyze/select/tui/App.js';
import { getRefineSessionPaths } from '../../../../src/analyze/select/persistence.js';
import { openPipelineDb, storeRawComponents, getOrCreateSession } from '../../../../src/session/db.js';
import type { RawComponentDefinition } from '../../../../src/types.js';

const RAW_COMPONENTS: RawComponentDefinition[] = [
  {
    name: 'Accordion',
    source: 'src/Accordion.tsx',
    framework: 'react',
    props: [],
    slots: [],
  },
  {
    name: 'AccordionHeader',
    source: 'src/AccordionHeader.tsx',
    framework: 'react',
    props: [],
    slots: [],
  },
];

describe('App E2E', () => {
  let projectDir: string;
  let artifactsDir: string;
  let dbDir: string;
  let sessionId: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'eds-e2e-proj-'));
    artifactsDir = await mkdtemp(join(tmpdir(), 'eds-e2e-arts-'));
    dbDir = await mkdtemp(join(tmpdir(), 'eds-e2e-db-'));

    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'src', 'Accordion.tsx'), '// stub', 'utf8');
    await writeFile(join(projectDir, 'src', 'AccordionHeader.tsx'), '// stub', 'utf8');

    const dbPath = join(dbDir, 'pipeline.db');
    process.env.EDS_PIPELINE_DB_PATH = dbPath;

    const db = openPipelineDb(dbPath);
    const { sessionId: sid } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    sessionId = sid;
    storeRawComponents(db, sessionId, RAW_COMPONENTS);
    db.close();
  });

  afterEach(async () => {
    delete process.env.EDS_PIPELINE_DB_PATH;
    await rm(projectDir, { recursive: true, force: true });
    await rm(artifactsDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  });

  it('accepts, rejects, and finalizes — session state reflects decisions', async () => {
    const { stdin, lastFrame } = render(
      <App sessionId={sessionId} artifactsRoot={artifactsDir} reviewRoot={projectDir} />,
    );

    // Wait for session to load
    await new Promise((r) => setTimeout(r, 300));

    expect(lastFrame()).toContain('Accordion');

    // Accept the first component (Accordion is auto-selected)
    stdin.write('a');
    await new Promise((r) => setTimeout(r, 50));

    // Navigate to second component
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 50));

    // Reject second component
    stdin.write('r');
    await new Promise((r) => setTimeout(r, 50));

    // Verify status bar
    const frameAfterActions = lastFrame() ?? '';
    expect(frameAfterActions).toContain('1 accepted');
    expect(frameAfterActions).toContain('1 rejected');

    // Open finalize dialog
    stdin.write('F');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Save decisions and exit?');

    // Confirm finalize (mock process.exit so test doesn't terminate)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      return undefined as never;
    });

    stdin.write('y');
    await new Promise((r) => setTimeout(r, 300));

    // Verify decisions are saved in the session state file
    const paths = await getRefineSessionPaths(sessionId, artifactsDir);
    const stateRaw = await readFile(paths.statePath, 'utf8');
    const state = JSON.parse(stateRaw) as { components: Array<{ name: string; status: string }> };

    const accordion = state.components.find((c) => c.name === 'Accordion');
    const accordionHeader = state.components.find((c) => c.name === 'AccordionHeader');

    expect(accordion?.status).toBe('accepted');
    expect(accordionHeader?.status).toBe('rejected');

    exitSpy.mockRestore();
  });
});

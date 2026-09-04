import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import {
  getOrCreateSession,
  openPipelineDb,
  storeCDFComponents,
  storeRawComponents,
} from '../../../src/session/db.js';
import type { RawComponentDefinition } from '../../../src/types.js';

const mapInvocations: string[][] = [];

vi.mock('../../../src/import/tui/runScopeGate.js', () => ({
  runScopeGate: async ({ onAdvanceToGenerate }: { onAdvanceToGenerate: (result: unknown) => Promise<void> }) => {
    await onAdvanceToGenerate({ sessionId: 'extract-session', acceptedCount: 1 });
  },
}));

vi.mock('../../../src/import/tui/scope-gate-host.js', () => ({
  ScopeGateHost: ({ onConfirm }: { onConfirm: (decisions: Record<string, unknown>) => void }) => {
    const confirmed = useRef(false);
    useEffect(() => {
      if (!confirmed.current) {
        confirmed.current = true;
        onConfirm({});
      }
    }, [onConfirm]);
    return <></>;
  },
}));

vi.mock('../../../src/import/tui/final-review-host.js', () => ({
  FinalReviewHost: () => <Text>FINAL_REVIEW</Text>,
}));

vi.mock('../../../src/import/tui/spawn-generate.js', () => ({
  spawnGenerateChild: () => ({
    child: { kill: vi.fn() },
    donePromise: Promise.resolve({
      exitCode: 0,
      signal: null,
      stdout: 'session=generated-session\n',
      stderr: 'Generated 1 component\n',
    }),
  }),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((_command, args, callback) => {
      const commandArgs = args as string[];
      if (commandArgs.includes('map') && commandArgs.includes('tokens')) mapInvocations.push(commandArgs);
      callback(null, 'map tokens complete\nsession=generated-session\n1 mapping(s) applied\n', '');
    }),
    spawn: vi.fn((_command, args) => {
      const stdout = {
        on: (event: string, callback: (chunk: Buffer) => void) => {
          if (event === 'data' && (args as string[]).includes('extract')) callback(Buffer.from('session=extract-session\n'));
        },
      };
      const stderr = {
        on: (event: string, callback: (chunk: Buffer) => void) => {
          if (event === 'data' && (args as string[]).includes('extract')) callback(Buffer.from('Extracted 1 component\n'));
        },
      };
      return {
        stdout,
        stderr,
        on: (event: string, callback: (code: number) => void) => {
          if (event === 'exit') queueMicrotask(() => callback(0));
        },
      };
    }),
  };
});

vi.mock('@contentful/experience-design-system-generation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@contentful/experience-design-system-generation')>();
  return { ...actual, checkAgentAuth: vi.fn().mockResolvedValue('authenticated') };
});

const RAW: RawComponentDefinition[] = [
  {
    name: 'Card',
    source: 'src/Card.tsx',
    framework: 'react',
    props: [{ name: 'background', type: 'string', required: false, category: 'design' }],
    slots: [],
  },
];

function seedGeneratedSession(dbPath: string): void {
  const db = openPipelineDb(dbPath);
  try {
    for (const id of ['extract-session', 'generated-session']) {
      getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      db.prepare('UPDATE sessions SET id = ? WHERE id = (SELECT id FROM sessions ORDER BY rowid DESC LIMIT 1)').run(id);
      storeRawComponents(db, id, RAW);
      storeCDFComponents(db, id, [
        {
          key: 'Card',
          entry: {
            $type: 'component',
            $properties: { background: { $type: 'token', $category: 'design', '$token.kind': 'color' } },
          },
        },
      ]);
    }
  } finally {
    db.close();
  }
}

describe('WizardApp reused token catalog', () => {
  let dir: string;
  let previousDbPath: string | undefined;

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
    mapInvocations.length = 0;
  });

  it('materializes reused tokens and invokes map tokens with the generated session', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wizard-reuse-map-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    const projectPath = join(dir, 'project');
    const outDir = join(projectPath, '.contentful');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(projectPath, { recursive: true });
    await writeFile(join(dir, 'raw-tokens.json'), '{}');
    await writeFile(join(projectPath, 'Card.tsx'), 'export function Card() { return null; }');
    await writeFile(join(outDir, 'tokens.json'), JSON.stringify({ colors: { primary: { $type: 'color', $value: '#06f' } } }), {
      flag: 'w',
    }).catch(async () => {
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'tokens.json'), JSON.stringify({ colors: { primary: { $type: 'color', $value: '#06f' } } }));
    });
    seedGeneratedSession(process.env.EDS_PIPELINE_DB_PATH);

    const { WizardApp } = await import('../../../src/import/tui/WizardApp.js');
    const app = render(
      <WizardApp initialProjectPath={projectPath} initialRawTokensPath={join(dir, 'raw-tokens.json')} noPush />,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    app.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 100));
    app.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(app.lastFrame()).toContain('FINAL_REVIEW');
    expect(mapInvocations).toHaveLength(1);
    expect(mapInvocations[0]).toEqual(expect.arrayContaining(['map', 'tokens', '--session', 'generated-session']));
  });
});

import { Command } from 'commander';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { registerAnalyzeEditCommand } from '../../../src/analyze/select/command.js';
import { openPipelineDb, storeRawComponents, loadRawComponents, getOrCreateSession } from '../../../src/session/db.js';
import { describe, expect, it } from 'vitest';
import type { RawComponentDefinition } from '../../../src/types.js';

const reviewRoot = resolve(import.meta.dirname, '../../../../..');
const sampleComponents: RawComponentDefinition[] = [
  {
    name: 'Accordion',
    source: 'packages/experience-design-system-cli/test/fixtures/sample-components/Accordion.tsx',
    framework: 'react',
    props: [],
    slots: [],
  },
];

async function run(
  args: string[],
  options: { artifactsRoot?: string; dbPath?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  let stdout = '';
  let stderr = '';
  const analyze = new Command('analyze');
  const program = new Command().name('experience-design-system-cli');
  program.addCommand(analyze);
  registerAnalyzeEditCommand(analyze);
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalArtifactsDir = process.env.EDS_REVIEW_ARTIFACTS_DIR;
  const originalDbPath = process.env.EDS_PIPELINE_DB_PATH;

  program.configureOutput({
    writeOut: (value) => {
      stdout += value;
    },
    writeErr: (value) => {
      stderr += value;
    },
  });
  program.exitOverride();

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    if (options.artifactsRoot) {
      process.env.EDS_REVIEW_ARTIFACTS_DIR = options.artifactsRoot;
    }
    if (options.dbPath) {
      process.env.EDS_PIPELINE_DB_PATH = options.dbPath;
    }

    await program.parseAsync(['node', 'experience-design-system-cli', ...args], { from: 'node' });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const exitCode =
      typeof error === 'object' && error && 'code' in error && String(error.code).startsWith('commander.help')
        ? 0
        : typeof error === 'object' && error && 'exitCode' in error
          ? Number(error.exitCode)
          : 1;
    return { stdout, stderr, code: exitCode };
  } finally {
    if (originalArtifactsDir === undefined) {
      delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
    } else {
      process.env.EDS_REVIEW_ARTIFACTS_DIR = originalArtifactsDir;
    }
    if (originalDbPath === undefined) {
      delete process.env.EDS_PIPELINE_DB_PATH;
    } else {
      process.env.EDS_PIPELINE_DB_PATH = originalDbPath;
    }

    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

describe('analyze select command', () => {
  it('prints help with --help', async () => {
    const { stdout } = await run(['analyze', 'select', '--help']);
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--select-all');
    expect(stdout).toContain('--select');
    expect(stdout).toContain('--deselect');
    expect(stdout).toContain('--patch');
  });

  it('fails when no session exists and no --session flag is provided', async () => {
    const dbDir = await mkdtemp(join(tmpdir(), 'eds-edit-no-session-'));
    const dbPath = join(dbDir, 'pipeline.db');
    try {
      const { stderr, code } = await run(['analyze', 'select'], { dbPath });
      expect(code).toBe(1);
      expect(stderr).toContain('no completed analyze extract session');
    } finally {
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it('prints the launch contract for a valid session', async () => {
    const dbDir = await mkdtemp(join(tmpdir(), 'eds-edit-launch-'));
    const dbPath = join(dbDir, 'pipeline.db');
    const artifactsRoot = join(dbDir, 'contentful-review-artifacts');

    try {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      storeRawComponents(db, sessionId, sampleComponents);
      // Mark the step complete so the default resolver picks it up
      const { createStep, updateStep } = await import('../../../src/session/db.js');
      const stepId = createStep(db, sessionId, 'analyze extract', {
        project: reviewRoot,
      });
      updateStep(db, stepId, 'complete', { sessionId });
      db.close();

      process.env.EDS_REVIEW_TEST_MODE = '1';
      const { stdout, code } = await run(['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot], {
        artifactsRoot,
        dbPath,
      });
      delete process.env.EDS_REVIEW_TEST_MODE;

      expect(code).toBe(0);
      expect(stdout).toContain(`session=${sessionId}`);
      expect(stdout).toContain(`session_dir=${artifactsRoot}/${sessionId}`);
      expect(stdout).toContain('events.jsonl=');
      expect(stdout).toContain('current-review-state.json=');
    } finally {
      delete process.env.EDS_REVIEW_TEST_MODE;
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it('prints a concise stderr error when a component source file cannot be read', async () => {
    const dbDir = await mkdtemp(join(tmpdir(), 'eds-edit-missing-source-'));
    const dbPath = join(dbDir, 'pipeline.db');
    const artifactsRoot = join(dbDir, 'contentful-review-artifacts');

    try {
      const missingSourceComponents: RawComponentDefinition[] = [
        {
          name: 'MissingSourceComponent',
          source: 'packages/experience-design-system-cli/test/fixtures/sample-components/DoesNotExist.tsx',
          framework: 'react',
          props: [],
          slots: [],
        },
      ];

      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      storeRawComponents(db, sessionId, missingSourceComponents);
      db.close();

      const { stderr, code } = await run(['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot], {
        artifactsRoot,
        dbPath,
      });

      expect(code).toBe(1);
      expect(stderr).toContain('Error: unable to initialize refine session.');
      expect(stderr).toContain('Unable to access component source for MissingSourceComponent');
      expect(stderr).not.toContain('at loadReviewInput');
    } finally {
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it('non-interactive: accept-all accepts all components and writes session state', async () => {
    const dbDir = await mkdtemp(join(tmpdir(), 'eds-edit-accept-all-'));
    const dbPath = join(dbDir, 'pipeline.db');
    const artifactsRoot = join(dbDir, 'contentful-review-artifacts');

    try {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      storeRawComponents(db, sessionId, sampleComponents);
      db.close();

      const { stderr, code } = await run(
        ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all'],
        { artifactsRoot, dbPath },
      );

      expect(code).toBe(0);
      expect(stderr).toContain('Accepted: 1');
      expect(stderr).toContain('Rejected: 0');
    } finally {
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it('non-interactive: accept-all persists editedProposal back to DB via storeRawComponents', async () => {
    const dbDir = await mkdtemp(join(tmpdir(), 'eds-edit-db-sync-'));
    const dbPath = join(dbDir, 'pipeline.db');
    const artifactsRoot = join(dbDir, 'contentful-review-artifacts');

    const componentsWithProps: RawComponentDefinition[] = [
      {
        name: 'Accordion',
        source: 'packages/experience-design-system-cli/test/fixtures/sample-components/Accordion.tsx',
        framework: 'react',
        props: [
          { name: 'title', type: 'string', required: true, category: 'content' },
          { name: 'expanded', type: 'boolean', required: false, category: 'state', defaultValue: 'false' },
        ],
        slots: [{ name: 'children', isDefault: true }],
      },
    ];

    try {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      storeRawComponents(db, sessionId, componentsWithProps);
      db.close();

      const { stderr, code } = await run(
        ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--select-all'],
        { artifactsRoot, dbPath },
      );

      expect(code).toBe(0);
      expect(stderr).toContain('Accepted: 1');

      const db2 = openPipelineDb(dbPath);
      const persisted = loadRawComponents(db2, sessionId);
      db2.close();

      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.name).toBe('Accordion');
      expect(persisted[0]!.props).toHaveLength(2);
      expect(persisted[0]!.props[0]!.name).toBe('title');
      expect(persisted[0]!.props[0]!.type).toBe('string');
      expect(persisted[0]!.props[0]!.required).toBe(true);
      expect(persisted[0]!.props[1]!.name).toBe('expanded');
      expect(persisted[0]!.props[1]!.defaultValue).toBe('false');
      expect(persisted[0]!.slots).toHaveLength(1);
      expect(persisted[0]!.slots[0]!.name).toBe('children');
    } finally {
      await rm(dbDir, { recursive: true, force: true });
    }
  });

  it('non-interactive: reject pattern rejects matching components', async () => {
    const dbDir = await mkdtemp(join(tmpdir(), 'eds-edit-reject-'));
    const dbPath = join(dbDir, 'pipeline.db');
    const artifactsRoot = join(dbDir, 'contentful-review-artifacts');

    try {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
      });
      storeRawComponents(db, sessionId, sampleComponents);
      db.close();

      const { stderr, code } = await run(
        ['analyze', 'select', '--session', sessionId, '--project-root', reviewRoot, '--deselect', 'accordion'],
        { artifactsRoot, dbPath },
      );

      expect(code).toBe(0);
      expect(stderr).toContain('Rejected: 1');
    } finally {
      await rm(dbDir, { recursive: true, force: true });
    }
  });
});

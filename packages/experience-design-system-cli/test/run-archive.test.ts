import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInvoker } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { runSelectionPrototype } from '../src/api/selection-prototype.js';

const component: RawComponentDefinition = {
  name: 'Card',
  source: '/components/Card.tsx',
  framework: 'react',
  props: [],
  slots: [],
};

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'cli-v2-run-archive-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createInvoker(): AgentInvoker {
  let invocation = 0;
  return {
    invoke: vi.fn(async () => {
      const decision = invocation++ === 0 ? 'select_component' : 'reject_component';
      return {
        exitCode: 0,
        stdout: JSON.stringify({ tool: decision, name: 'Card', reason: 'agent judgment' }),
        stderr: '',
        timedOut: false,
      };
    }),
    checkAuth: vi.fn(),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('selection run archive', () => {
  it('persists metadata and an artifact for every completed pipeline stage', async () => {
    const root = await makeTemporaryDirectory();
    const result = await runSelectionPrototype({
      components: [component],
      agentCount: 2,
      invoker: createInvoker(),
      agent: 'claude',
      timeoutMs: 10_000,
      outDir: '/tmp/selection-run',
      buildPrompt: async () => 'selection prompt',
      verifyFactual: async () => ({ disagreementId: 'unused' }),
      debateInterpretive: async (disagreement) => ({
        disagreementId: disagreement.id,
        decision: 'accepted',
        reason: 'debate resolved the judgment',
      }),
      archive: {
        root,
        command: 'experiences-v2 importv2',
        cliVersion: '2.34.4-test',
        projectPath: '/projects/example-design-system',
      },
    });

    const runEntries = await readdir(root);
    expect(runEntries).toHaveLength(1);
    const runDirectory = join(root, runEntries[0]);
    const metadata = JSON.parse(await readFile(join(runDirectory, 'metadata.json'), 'utf8')) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      runId: runEntries[0],
      command: 'experiences-v2 importv2',
      cliVersion: '2.34.4-test',
      projectPath: '/projects/example-design-system',
      status: 'completed',
      componentCount: 1,
      agentCount: 2,
      disagreementCount: 1,
      factualDisagreementCount: 0,
      interpretiveDisagreementCount: 1,
      escalationCount: 1,
      debateCount: 1,
      determinationCount: 1,
      unresolvedCount: 0,
    });
    expect(runEntries[0]).toMatch(/^example-design-system-/);
    expect(metadata.timestamp).toEqual(expect.any(String));
    expect(metadata.startedAt).toEqual(expect.any(String));
    expect(metadata.completedAt).toEqual(expect.any(String));
    expect(metadata.executedStages).toEqual([
      'stage1-broadcast',
      'stage2-diff',
      'stage3-tier',
      'stage4b-debate',
      'stage5-determination',
      'final-selection',
    ]);

    expect(JSON.parse(await readFile(join(runDirectory, 'stage1-broadcast', 'agent-1.json'), 'utf8'))).toMatchObject({
      agentIndex: 0,
      results: [{ componentKey: 'Card::/components/Card.tsx', decision: 'accepted' }],
    });
    expect(JSON.parse(await readFile(join(runDirectory, 'stage2-diff.json'), 'utf8'))).toMatchObject({
      disagreements: [{ id: 'd1', field: 'decision' }],
    });
    expect(JSON.parse(await readFile(join(runDirectory, 'stage4b-debate', 'd1.json'), 'utf8'))).toMatchObject({
      disagreementId: 'd1',
      decision: 'accepted',
    });
    expect(JSON.parse(await readFile(join(runDirectory, 'final-selection.json'), 'utf8'))).toMatchObject({
      assembly: { selections: [{ componentKey: 'Card::/components/Card.tsx', decision: 'accepted' }] },
    });
    expect((await stat(join(runDirectory, 'metadata.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(runDirectory, 'stage1-broadcast'))).mode & 0o777).toBe(0o700);
    expect(result.archive.runId).toBe(runEntries[0]);
    expect(result.archive.runDirectory).toBe(runDirectory);
  });

  it('uses the supplied root and gives consecutive runs unique folders', async () => {
    const root = await makeTemporaryDirectory();
    const options = {
      components: [component],
      agentCount: 1,
      invoker: createInvoker(),
      agent: 'claude' as const,
      timeoutMs: 10_000,
      outDir: '/tmp/selection-run',
      buildPrompt: async () => 'selection prompt',
      verifyFactual: async () => ({ disagreementId: 'unused' }),
      archive: { root },
    };

    const first = await runSelectionPrototype(options);
    const second = await runSelectionPrototype({ ...options, invoker: createInvoker() });
    const entries = await readdir(root);

    expect(entries).toEqual([first.archive.runId, second.archive.runId].sort());
    expect(first.archive.runId).not.toBe(second.archive.runId);
    expect((await stat(first.archive.runDirectory)).isDirectory()).toBe(true);
    expect((await stat(second.archive.runDirectory)).isDirectory()).toBe(true);
  });

  it('surfaces archive failures instead of silently dropping the run', async () => {
    const container = await makeTemporaryDirectory();
    const root = join(container, 'not-a-directory');
    await writeFile(root, 'archive root must be a directory');

    await expect(
      runSelectionPrototype({
        components: [component],
        agentCount: 1,
        invoker: createInvoker(),
        agent: 'claude',
        timeoutMs: 10_000,
        outDir: '/tmp/selection-run',
        buildPrompt: async () => 'selection prompt',
        verifyFactual: async () => ({ disagreementId: 'unused' }),
        archive: { root },
      }),
    ).rejects.toThrow();
  });
});

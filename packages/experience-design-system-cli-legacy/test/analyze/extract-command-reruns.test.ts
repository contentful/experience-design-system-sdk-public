import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCliWithEnv } from '../helpers/cli-runner.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Workspace {
  projectDir: string;
  env: Record<string, string>;
  agentCalls(): Promise<number>;
}

async function createWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), 'extract-reruns-'));
  tempDirs.push(root);
  const projectDir = join(root, 'project');
  const binDir = join(root, 'bin');
  const callLog = join(root, 'agent-calls.log');
  await mkdir(join(projectDir, 'src'), { recursive: true });
  await mkdir(binDir, { recursive: true });
  await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  await writeFile(
    join(projectDir, 'src', 'Field.tsx'),
    [
      "import React from 'react';",
      'export interface FieldProps {',
      '  name: string;',
      '  icon?: string;',
      '  label: string;',
      '}',
      'export function Field({ name, icon, label }: FieldProps) {',
      '  return <label htmlFor={name}>{icon}{label}</label>;',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(join(projectDir, 'src', 'registry.ts'), 'export const registry = {};\n');
  const agent = join(binDir, 'claude');
  await writeFile(
    agent,
    `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(callLog)}, 'call\\n');\n`,
  );
  await chmod(agent, 0o755);
  return {
    projectDir,
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      EDS_PIPELINE_DB_PATH: join(root, 'pipeline.db'),
      NODE_NO_WARNINGS: '1',
    },
    agentCalls: async () => {
      try {
        return (await readFile(callLog, 'utf8')).split('\n').filter(Boolean).length;
      } catch {
        return 0;
      }
    },
  };
}

describe('__extract reruns', () => {
  it('never calls a coding agent, however many times an unchanged project is extracted', async () => {
    const workspace = await createWorkspace();
    const args = ['__extract', '--project', workspace.projectDir];

    const first = await runCliWithEnv(args, workspace.env, 60_000);
    expect(first.code).toBe(0);

    const second = await runCliWithEnv(args, workspace.env, 60_000);
    expect(second.code).toBe(0);
    expect(second.stderr).not.toContain('progress=composition:cache-hit');
    expect(second.stderr).not.toContain('progress=composition:agent');
    expect(await workspace.agentCalls()).toBe(0);
  });

  it('rejects --no-cache as an unknown option', async () => {
    const workspace = await createWorkspace();

    const result = await runCliWithEnv(
      ['__extract', '--project', workspace.projectDir, '--no-cache'],
      workspace.env,
      60_000,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--no-cache'");
    expect(await workspace.agentCalls()).toBe(0);
  });

  it.each(['--composition-refresh', '--agent=claude', '--bedrock'])('rejects %s as an unknown option', async (flag) => {
    const workspace = await createWorkspace();

    const result = await runCliWithEnv(['__extract', '--project', workspace.projectDir, flag], workspace.env, 60_000);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('unknown option');
    expect(await workspace.agentCalls()).toBe(0);
  });
});

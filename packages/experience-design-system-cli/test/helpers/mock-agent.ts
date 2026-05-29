import { writeFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export type MockAgent = {
  dir: string;
  cleanup: () => Promise<void>;
  env: () => Record<string, string>;
};

export async function createMockAgent(agentName = 'claude', output = '{"result": "mock"}'): Promise<MockAgent> {
  const dir = await mkdtemp(join(tmpdir(), 'mock-agent-'));
  const script = join(dir, agentName);
  await writeFile(script, `#!/bin/sh\necho '${output}'`);
  await chmod(script, '755');
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
    env: () => ({ PATH: `${dir}:${process.env.PATH}` }),
  };
}

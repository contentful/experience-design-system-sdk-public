import { spawn } from 'node:child_process';
import type { AgentName } from '../../../agent-names.js';
import type { AgentAuthStatus } from '../../../types/agent.js';
import { resolveAgentBinary } from './resolve-agent-binary.js';

export async function checkAgentAuth(agent: AgentName): Promise<AgentAuthStatus> {
  const binary = resolveAgentBinary(agent);

  const binaryExists = await new Promise<boolean>((resolve) => {
    if (binary.startsWith('/')) {
      import('node:fs/promises').then((fs) =>
        fs.access(binary).then(
          () => resolve(true),
          () => resolve(false),
        ),
      );
      return;
    }
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [binary], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
  });
  if (!binaryExists) return 'not-found';

  if (agent !== 'claude') return 'ok';

  return new Promise((resolve) => {
    const child = spawn(binary, ['auth', 'status', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill('SIGTERM');
        resolve('unauthenticated');
      }
    }, 5000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve('unauthenticated');
        return;
      }
      try {
        const status = JSON.parse(stdout) as { loggedIn?: boolean };
        resolve(status.loggedIn ? 'ok' : 'unauthenticated');
      } catch {
        resolve('unauthenticated');
      }
    });
  });
}

import { spawn } from 'node:child_process';
import { resolveBinary } from '../helpers/resolution/resolve-binary.js';
import type { AgentAuthStatus } from '../types/agent-run.js';
import type { AgentName } from '../types/agent-name.js';

export async function checkAgentAuth(agent: AgentName): Promise<AgentAuthStatus> {
  const binary = resolveBinary(agent);

  const binaryExists = await binaryIsOnPath(binary);
  if (!binaryExists) return 'not-found';

  // Only Claude exposes `auth status --json`. Non-Claude agents are considered
  // authenticated once their binary is present.
  if (agent !== 'claude') return 'ok';

  return new Promise((resolve) => {
    const child = spawn(binary, ['auth', 'status', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGTERM');
      resolve('unauthenticated');
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

async function binaryIsOnPath(binary: string): Promise<boolean> {
  if (binary.startsWith('/')) {
    const fs = await import('node:fs/promises');
    return fs.access(binary).then(
      () => true,
      () => false,
    );
  }
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [binary], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
  });
}

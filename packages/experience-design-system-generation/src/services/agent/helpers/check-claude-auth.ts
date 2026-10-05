import { spawn } from 'node:child_process';
import type { AgentAuthStatus } from '../../../types/agent.js';

export function checkClaudeAuth(binary: string): Promise<AgentAuthStatus> {
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

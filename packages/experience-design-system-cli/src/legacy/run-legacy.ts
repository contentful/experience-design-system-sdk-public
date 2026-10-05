import { spawn } from 'node:child_process';
import { findLegacyCliPath } from './legacy-cli-path.js';

export function runLegacy(args: string[]): Promise<number> {
  return new Promise((resolvePromise) => {
    let cliPath: string;
    try {
      cliPath = findLegacyCliPath();
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      resolvePromise(1);
      return;
    }

    const child = spawn('node', [cliPath, ...args], { stdio: 'inherit' });
    child.on('close', (code) => resolvePromise(code ?? 1));
    child.on('error', (err) => {
      process.stderr.write(`${err.message}\n`);
      resolvePromise(1);
    });
  });
}

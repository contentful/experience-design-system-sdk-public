import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTmpHome() {
  const home = mkdtempSync(join(tmpdir(), 'eds-pty-home-'));
  return {
    home,
    env: { HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
    cleanup: () => {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {}
    },
  };
}

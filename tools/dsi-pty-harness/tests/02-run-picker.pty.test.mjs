import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWizard } from '../src/harness.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';

function seedRunsJson(home) {
  const dir = join(home, '.config', 'experiences');
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(dir, 'runs.json'),
    JSON.stringify(
      {
        version: 3,
        runs: [
          {
            id: 'run-stub-0001',
            createdAt: now,
            updatedAt: now,
            kind: 'import',
            status: 'completed',
            projectPath: '/tmp/fake-project',
            title: 'seeded stub run',
            sessionId: 'sess-stub-0001',
            steps: [],
          },
        ],
      },
      null,
      2,
    ),
  );
}

describe('run-picker', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('offers to start a new run when prior runs exist', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    seedRunsJson(t.home);

    const w = await spawnWizard(['import'], { env: t.env });
    cleanups.push(() => w.close());

    await w.waitFor(/Found .* prior run/i, { timeout: 10000 });
    w.writeKey('n');
    await w.waitFor('Where is your component library?', { timeout: 8000 });

    expect(w.getScreen()).toMatch(/Where is your component library/);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';
import {
  applyScopeDecisions,
  getOrCreateSession,
  loadScopeComponents,
  openPipelineDb,
  storeRawComponents,
} from '../../../src/session/db.js';
import type { RawComponentDefinition } from '../../../src/types.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'scope-gate-int-test-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeComponent(name: string): RawComponentDefinition {
  return { name, source: `// ${name}`, framework: 'react', props: [], slots: [] };
}

describe('ScopeGateStep + applyScopeDecisions integration', () => {
  it('user toggles in TUI → DB reflects the decision', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
        inputPath: '/proj',
      });
      storeRawComponents(db, sessionId, [makeComponent('Button'), makeComponent('Junk')], { status: 'extracted' });
      const components = loadScopeComponents(db, sessionId);

      const onConfirm = vi.fn((decisions: { accepted: string[]; rejected: string[] }) => {
        applyScopeDecisions(db, sessionId, decisions);
      });
      const { stdin } = render(<ScopeGateStep components={[...components]} onConfirm={onConfirm} onQuit={() => {}} />);
      stdin.write('a');
      stdin.write('f');

      expect(onConfirm).toHaveBeenCalledTimes(1);
      const rows = db
        .prepare('SELECT name, status FROM raw_components WHERE session_id = ? ORDER BY name')
        .all(sessionId) as Array<{ name: string; status: string }>;
      expect(rows).toEqual([
        { name: 'Button', status: 'generated' },
        { name: 'Junk', status: 'rejected' },
      ]);
      db.close();
    });
  });
});

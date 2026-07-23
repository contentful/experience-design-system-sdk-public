import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';
import {
  getOrCreateSession,
  loadScopeComponents,
  openPipelineDb,
  storeRawComponents,
} from '../../../src/session/db.js';
import type { RawComponentDefinition } from '../../../src/types.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'scope-gate-slot-plumbing-'));
  tempDirs.push(dir);
  await run(join(dir, 'pipeline.db'));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeComponent(
  name: string,
  slots: Array<{ name: string; allowedComponents?: string[] }> = [],
): RawComponentDefinition {
  return {
    name,
    source: `// ${name}`,
    framework: 'react',
    props: [],
    slots: slots.map((s) => ({
      name: s.name,
      isDefault: false,
      ...(s.allowedComponents ? { allowedComponents: s.allowedComponents } : {}),
    })),
  };
}

describe('scope-gate slot plumbing (loader → ScopeGateStep)', () => {
  it('renders grouped roots + tree glyphs when loaded from a seeded session', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
        inputPath: '/proj',
      });
      storeRawComponents(
        db,
        sessionId,
        [
          makeComponent('Card', [{ name: 'body', allowedComponents: ['Heading'] }]),
          makeComponent('Heading'),
          makeComponent('Layout', [
            { name: 'header', allowedComponents: ['LayoutHeader'] },
            { name: 'sidebar', allowedComponents: ['LayoutSidebar'] },
            { name: 'footer', allowedComponents: ['LayoutFooter'] },
          ]),
          makeComponent('LayoutHeader'),
          makeComponent('LayoutSidebar'),
          makeComponent('LayoutFooter'),
          makeComponent('Standalone'),
        ],
        { status: 'extracted' },
      );

      const components = loadScopeComponents(db, sessionId);
      db.close();

      expect(components.find((c) => c.name === 'Card')?.slots).toEqual([
        { name: 'body', allowedComponents: ['Heading'] },
      ]);

      const { lastFrame } = render(<ScopeGateStep components={components} onConfirm={() => {}} onQuit={() => {}} />);
      const out = lastFrame() ?? '';

      expect(out).toMatch(/▾ Card \(1 dep\)/);
      expect(out).toMatch(/▾ Layout \(3 deps\)/);
      expect(out).toContain('Standalone');
      expect(out).not.toMatch(/[▸▾] Standalone/);
    });
  });

  it('preserves cycle-tier + sticky inclusion behavior with loader-plumbed slots', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'analyze extract',
        inputPath: '/proj',
      });
      storeRawComponents(
        db,
        sessionId,
        [
          makeComponent('Card', [{ name: 'body', allowedComponents: ['Heading'] }]),
          makeComponent('Heading'),
          makeComponent('Standalone'),
        ],
        { status: 'extracted' },
      );
      db.prepare(
        `UPDATE raw_components SET status = 'rejected', reject_reason = ? WHERE session_id = ? AND name = ?`,
      ).run('not a design-system primitive', sessionId, 'Standalone');

      const components = loadScopeComponents(db, sessionId);
      db.close();

      expect(components.find((c) => c.name === 'Standalone')?.aiDecision).toBe('rejected');
      expect(components.find((c) => c.name === 'Card')?.slots).toEqual([
        { name: 'body', allowedComponents: ['Heading'] },
      ]);

      const onConfirm = vi.fn();
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={components} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      expect(lastFrame() ?? '').toMatch(/▾ Card \(1 dep\)/);

      stdin.write('r');
      stdin.write('a');
      stdin.write('f');

      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Heading']));
      expect(arg.rejected).toEqual(['Standalone']);
    });
  });
});

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

// End-to-end plumbing test for the composite scope-gate: seed a session DB
// with a small slotted graph, run `loadScopeComponents`, mount
// `ScopeGateStep` with the exact rows the wizard would hand it, and assert
// GroupedSidebar sees the closures (i.e. the loader-side slot join actually
// reaches the UI).

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
      // Two independent slotted roots (Card, Layout) with disjoint deps so
      // both show up as distinct grouped roots — plus a Standalone with no
      // slots at all. Matches the shape described in the task brief:
      //   ▸ Card   (1 dep)
      //   ▸ Layout (3 deps)
      //   Standalone
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

      // Loader hands the wizard a well-formed shape (spot-check — loader tests
      // cover the full assertion set).
      expect(components.find((c) => c.name === 'Card')?.slots).toEqual([
        { name: 'body', allowedComponents: ['Heading'] },
      ]);

      const { lastFrame } = render(
        <ScopeGateStep components={components} onConfirm={() => {}} onQuit={() => {}} />,
      );
      const out = lastFrame() ?? '';

      // Card has 1 dep (Heading).
      expect(out).toMatch(/▸ Card \(1 dep\)/);
      // Layout has 3 deps (Header/Sidebar/Footer).
      expect(out).toMatch(/▸ Layout \(3 deps\)/);
      // Standalone stays flat.
      expect(out).toContain('Standalone');
      expect(out).not.toMatch(/▸ Standalone/);
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
      // Simulate an AI rejection on the standalone (not on a closure member),
      // so we can verify the AI-recommended-exclusion overlay survives the
      // loader → UI trip without interacting with closure sticky semantics.
      db.prepare(
        `UPDATE raw_components SET status = 'rejected', reject_reason = ? WHERE session_id = ? AND name = ?`,
      ).run('not a design-system primitive', sessionId, 'Standalone');

      const components = loadScopeComponents(db, sessionId);
      db.close();

      // AI-recommended-exclusion + slot graph both plumbed through.
      expect(components.find((c) => c.name === 'Standalone')?.aiDecision).toBe('rejected');
      expect(components.find((c) => c.name === 'Card')?.slots).toEqual([
        { name: 'body', allowedComponents: ['Heading'] },
      ]);

      const onConfirm = vi.fn();
      const { lastFrame, stdin } = render(
        <ScopeGateStep components={components} onConfirm={onConfirm} onQuit={() => {}} />,
      );
      // Grouped root visible → slot data reached the UI.
      expect(lastFrame() ?? '').toMatch(/▸ Card \(1 dep\)/);

      // Cursor starts on the Card root row. Toggling the closure off and back
      // on exercises PR #105 sticky-inclusion + closure semantics against the
      // loader-plumbed graph.
      stdin.write(' '); // exclude Card + Heading closure
      stdin.write(' '); // re-include
      stdin.write('f');

      const arg = onConfirm.mock.calls[0][0];
      expect(arg.accepted).toEqual(expect.arrayContaining(['Card', 'Heading']));
      // Standalone was AI-rejected and untouched — stays in `rejected`.
      expect(arg.rejected).toEqual(['Standalone']);
    });
  });
});

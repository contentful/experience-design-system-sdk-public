import { preflightGenerationResult, readGenerationContext } from '../generation-fixture.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completeSourceFixture } from '../source-fixture.js';
import { expect, it, vi } from 'vitest';
import {
  openPipelineDb,
  getOrCreateSession,
  loadRawComponents,
} from '../../src/persistence/src/session/repositories/db.js';

vi.mock('../../src/agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({
    invoke: async ({ prompt }: { prompt: string }) => {
      const decoded = JSON.parse(
        readGenerationContext(prompt).match(/Raw component data \(JSON\):\n```json\n([\s\S]*?)\n```/)![1]!,
      );
      const raw = Array.isArray(decoded) ? decoded[0] : decoded;
      return preflightGenerationResult(prompt, {
        stdout:
          JSON.stringify({ tool: 'classify_component' }) +
          '\n' +
          raw.slots
            .map((slot: { name: string }) => JSON.stringify({ tool: 'classify_slot', slot: slot.name }))
            .join('\n') +
          '\n' +
          JSON.stringify({
            tool: 'classify_prop',
            prop: 'label',
            cdf_type: 'string',
            cdf_category: 'content',
            required: false,
          }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      });
    },
  }),
}));
vi.mock('../../src/analytics/index.js', () => ({ bindAnalyticsSessionId: async () => {} }));

import {
  runGenerateComponentsSession,
  type GenerateComponentsProgress,
} from '../../src/orchestrators/run-generate-components-session/run-generate-components-session.js';

it.each([
  ['', 1],
  ['content', 0],
] as const)('retains actual compatibility slot rename events and aggregate counts for %j', async (slotName, count) => {
  const root = mkdtempSync(join(tmpdir(), 'cleanup-preservation-'));
  const previousDb = process.env.EDS_PIPELINE_DB_PATH;
  const previousReviews = process.env.EDS_REVIEW_ARTIFACTS_DIR;
  process.env.EDS_PIPELINE_DB_PATH = join(root, 'pipeline.db');
  process.env.EDS_REVIEW_ARTIFACTS_DIR = join(root, 'reviews');
  try {
    const db = openPipelineDb();
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const source = join(root, 'Panel.tsx');
    writeFileSync(source, 'export function Panel(props: {label?: string}) {return <div/>}');
    await completeSourceFixture(db, sessionId, root, [
      {
        name: 'Panel',
        source,
        sourcePath: source,
        framework: 'react',
        props: [{ name: 'label', type: 'string', required: false }],
        slots: [{ name: slotName, isDefault: true }],
      },
    ]);
    db.close();
    const events: GenerateComponentsProgress[] = [];
    const generated = await runGenerateComponentsSession({
      sessionId,
      agent: 'codex',
      noCache: true,
      promptOverrides: ['generate=text:Classify supplied source.'],
      onProgress: (event) => events.push(event),
    });
    expect(generated.allOk, JSON.stringify(generated)).toBe(true);
    expect(generated.renamedSlotsCount).toBe(count);
    expect(generated.results[0]!.renamedSlotsCount).toBe(count);
    const renamed = events.filter((event) => event.kind === 'component:slot-renamed');
    expect(renamed).toHaveLength(count);
    if (count > 0) expect(renamed[0]).toMatchObject({ oldName: '', newName: 'children' });
    const reopened = openPipelineDb();
    try {
      expect(loadRawComponents(reopened, sessionId)[0]!.slots[0]!.name).toBe(count ? 'children' : slotName);
    } finally {
      reopened.close();
    }
  } finally {
    if (previousDb === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDb;
    if (previousReviews === undefined) delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
    else process.env.EDS_REVIEW_ARTIFACTS_DIR = previousReviews;
    rmSync(root, { recursive: true, force: true });
  }
});

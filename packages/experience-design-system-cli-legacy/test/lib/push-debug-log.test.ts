import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import {
  DEBUG_SESSION_DIR_ENV,
  startPushDebugRun,
  summarizeCdf,
  summarizePreview,
} from '../../src/lib/push-debug-log.js';

describe('startPushDebugRun', () => {
  let dir: string;

  const readLog = (): string => {
    const files = readdirSync(join(dir, 'import'));
    expect(files).toHaveLength(1);
    return readFileSync(join(dir, 'import', files[0]!), 'utf8');
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'push-debug-'));
    process.env[DEBUG_SESSION_DIR_ENV] = dir;
  });

  afterEach(() => {
    delete process.env[DEBUG_SESSION_DIR_ENV];
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes nothing when the v2 CLI did not set a session directory', () => {
    delete process.env[DEBUG_SESSION_DIR_ENV];
    const run = startPushDebugRun({ space_id: 's' });
    run.event('Preview started');
    run.finish({ outcome: 'pushed', summary: 'done' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('writes the file as soon as the push starts, so a killed push still leaves a log', () => {
    const run = startPushDebugRun({ space_id: 'space1', environment_id: 'env1', host: 'https://api.contentful.com' });
    run.event('Preview started');
    const log = readLog();
    expect(log).toContain('# Push to Contentful — debug log');
    expect(log).toContain('In progress');
    expect(log).toContain('`space1` / `env1`');
    expect(log).toContain('Preview started');
  });

  it('puts the result and a plain-English reason at the top when nothing is sent', () => {
    const run = startPushDebugRun({ space_id: 'space1', environment_id: 'env1' });
    run.finish({
      outcome: 'nothing-to-push',
      summary: 'The server says everything already matches.',
      details: { preview: { components: { unchanged: ['Button', 'Image'] } } },
    });
    const log = readLog();
    expect(log.indexOf('Nothing to push')).toBeLessThan(log.indexOf('## Timeline'));
    expect(log).toContain('The server says everything already matches.');
    expect(log).toContain('"Button"');
  });

  it('records a timeline with request ids and collapsible details', () => {
    const run = startPushDebugRun({});
    run.event('Server previewed the CDF', { data: { components: { new: ['Button'] } }, requestId: 'req-123' });
    run.finish({ outcome: 'pushed', summary: '2 of 2 items applied.' });
    const log = readLog();
    expect(log).toContain('(request req-123)');
    expect(log).toContain('`req-123`');
    expect(log).toContain('<details>');
    expect(log).toContain('"new": [');
  });

  it('redacts the CMA token and token-shaped strings', () => {
    const run = startPushDebugRun({ cma_token: 'CFPAT-abcdefghijklmnopqrstuvwxyz0123456789' });
    run.event('Note', { data: { header: 'Bearer abc.def.ghi' } });
    run.finish({ outcome: 'failed', summary: 'nope' });
    const log = readLog();
    expect(log).toContain('[present, 42 chars]');
    expect(log).not.toContain('CFPAT-abcdefghijklmnopqrstuvwxyz0123456789');
    expect(log).not.toContain('Bearer abc.def.ghi');
  });

  it('keeps the first result and numbers later pushes', () => {
    const first = startPushDebugRun({});
    first.finish({ outcome: 'failed', summary: 'first' });
    first.finish({ outcome: 'pushed', summary: 'second' });
    startPushDebugRun({}).finish({ outcome: 'pushed', summary: 'another push' });

    const files = readdirSync(join(dir, 'import')).sort();
    expect(files).toHaveLength(2);
    expect(files[1]).toMatch(/push-attempt-2\.md$/);
    expect(readFileSync(join(dir, 'import', files[0]!), 'utf8')).toContain('first');
    expect(readFileSync(join(dir, 'import', files[0]!), 'utf8')).not.toContain('second');
  });
});

describe('summaries', () => {
  it('reduces a preview to the names in each group and flags breaking changes', () => {
    const preview = {
      components: {
        new: [{ key: 'Card' }],
        changed: [{ current: { name: 'Button' }, changeClassification: { classification: 'breaking' } }],
        unchanged: ['Image'],
        removed: [{ name: 'Old' }],
      },
      tokens: { new: [], changed: [], unchanged: [], removed: [] },
      taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
    } as unknown as ServerPreviewResponse;

    expect(summarizePreview(preview)).toEqual({
      components: { new: ['Card'], changed: ['Button (breaking)'], unchanged: ['Image'], removed: ['Old'] },
      tokens: { new: [], changed: [], unchanged: [], removed: [] },
    });
  });

  it('lists each CDF entry with its type, properties and slots', () => {
    const cdf = {
      $schema: 'https://contentful.com/schemas/cdf',
      Button: { $type: 'component', $properties: { label: {}, size: {} }, $slots: { icon: {} } },
    };
    expect(summarizeCdf(cdf)).toEqual([
      { name: 'Button', type: 'component', properties: ['label', 'size'], slots: ['icon'] },
    ]);
  });
});

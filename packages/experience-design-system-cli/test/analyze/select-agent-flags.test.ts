import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../helpers/fixtures.js';
import { createMockAgent, type MockAgent } from '../helpers/mock-agent.js';
import { HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON } from '../../src/analyze/extract/source-inspection.js';

describe('analyze select-agent — flag variations', () => {
  let fixture: TestFixture;
  let agent: MockAgent;

  beforeAll(async () => {
    fixture = await createTestFixture();
    agent = await createMockAgent('claude');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await agent.cleanup();
  });

  const baseEnv = () => ({
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    NODE_NO_WARNINGS: '1',
    ...agent.env(),
  });

  // ── Help ──────────────────────────────────────────────────────────────────

  it('prints help with --help', async () => {
    const { stdout, code } = await runCli(['analyze', 'select-agent', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--agent');
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--model');
    expect(stdout).toContain('--verbose');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--project-root');
  });

  // ── Required flag guard ───────────────────────────────────────────────────

  it('fails without required --agent flag', async () => {
    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--session', fixture.sessionId],
      baseEnv(),
    );
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--agent|required/i);
  });

  // ── --dry-run ─────────────────────────────────────────────────────────────

  it('--dry-run prints the prompt without invoking the agent', async () => {
    const { stdout, code } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--dry-run'],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('--dry-run + --verbose prints the prompt without invoking the agent', async () => {
    const { stdout, code } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--dry-run', '--verbose'],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('--dry-run includes review reasons and needsReview signals when present', async () => {
    const wrapperFixture = await createTestFixture([
      {
        name: 'HeroBannerGql',
        source: 'src/HeroBannerGql.tsx',
        framework: 'react',
        props: [
          { name: 'id', type: 'string', required: true },
          { name: 'locale', type: 'string', required: true },
          { name: 'preview', type: 'boolean', required: true },
        ],
        slots: [],
        extractionConfidence: 2,
        reviewReasons: [HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON, 'data-wrapper:generated-query-hook'],
        needsReview: true,
      },
    ]);

    try {
      const { stdout, code } = await runCliWithEnv(
        [
          'analyze',
          'select-agent',
          '--agent',
          'claude',
          '--session',
          wrapperFixture.sessionId,
          '--project-root',
          wrapperFixture.projectDir,
          '--dry-run',
        ],
        {
          EDS_PIPELINE_DB_PATH: wrapperFixture.dbPath,
          NODE_NO_WARNINGS: '1',
          ...agent.env(),
        },
      );
      expect(code).toBe(0);
      expect(stdout).toContain('"reviewReasons"');
      expect(stdout).toContain(HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON);
      expect(stdout).toContain('"needsReview": true');
      expect(stdout).toContain('"extractionConfidence": 2');
      expect(stdout).toContain('"selectionContext"');
    } finally {
      await wrapperFixture.cleanup();
    }
  });

  it('persists bounded selection context in dry-run output when project-root is provided', async () => {
    const wrapperFixture = await createTestFixture([
      {
        name: 'HeroBannerGql',
        source: 'src/components/HeroBannerGql.tsx',
        framework: 'react',
        props: [
          { name: 'id', type: 'string', required: true },
          { name: 'locale', type: 'string', required: false },
          { name: 'preview', type: 'boolean', required: false },
        ],
        slots: [],
        extractionConfidence: 2,
        reviewReasons: [HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON, 'data-wrapper:generated-query-hook'],
        needsReview: true,
      },
    ]);

    try {
      await mkdir(join(wrapperFixture.projectDir, 'src/components'), {
        recursive: true,
      });
      await mkdir(join(wrapperFixture.projectDir, 'src/__generated'), {
        recursive: true,
      });
      await mkdir(join(wrapperFixture.projectDir, 'src/pages'), {
        recursive: true,
      });
      await writeFile(
        join(wrapperFixture.projectDir, 'src/components/HeroBannerGql.tsx'),
        `import { HeroBanner } from './HeroBanner';
import { useHeroBannerQuery } from '../__generated/useHeroBannerQuery';

export function HeroBannerGql({ id, locale, preview }: { id: string; locale?: string; preview?: boolean }) {
  const { data } = useHeroBannerQuery({ id, locale, preview });
  if (!data?.heroBanner) return null;
  return <HeroBanner {...data.heroBanner} />;
}
`,
        'utf8',
      );
      await writeFile(
        join(wrapperFixture.projectDir, 'src/components/HeroBanner.tsx'),
        `export function HeroBanner({ title, body }: { title: string; body: string }) {
  return <section><h1>{title}</h1><p>{body}</p></section>;
}
`,
        'utf8',
      );
      await writeFile(
        join(wrapperFixture.projectDir, 'src/components/registry.ts'),
        `import { HeroBannerGql } from './HeroBannerGql';

export const componentRegistry = {
  HeroBannerGql,
};
`,
        'utf8',
      );
      await writeFile(
        join(wrapperFixture.projectDir, 'src/pages/Home.tsx'),
        `import { HeroBannerGql } from '../components/HeroBannerGql';

export function Home() {
  return <HeroBannerGql id="hero-1" />;
}
`,
        'utf8',
      );
      await writeFile(
        join(wrapperFixture.projectDir, 'src/__generated/useHeroBannerQuery.ts'),
        `export function useHeroBannerQuery() {
  return { data: { heroBanner: { title: 'Hero', body: 'Body copy' } } };
}
`,
        'utf8',
      );

      wrapperFixture.addScannedFiles([
        join(wrapperFixture.projectDir, 'src/components/HeroBanner.tsx'),
        join(wrapperFixture.projectDir, 'src/components/registry.ts'),
        join(wrapperFixture.projectDir, 'src/pages/Home.tsx'),
        join(wrapperFixture.projectDir, 'src/__generated/useHeroBannerQuery.ts'),
      ]);

      const { stdout, code } = await runCliWithEnv(
        [
          'analyze',
          'select-agent',
          '--agent',
          'claude',
          '--session',
          wrapperFixture.sessionId,
          '--project-root',
          wrapperFixture.projectDir,
          '--dry-run',
        ],
        {
          EDS_PIPELINE_DB_PATH: wrapperFixture.dbPath,
          NODE_NO_WARNINGS: '1',
          ...agent.env(),
        },
      );
      expect(code).toBe(0);
      expect(stdout).toContain('"selectionContext"');
      expect(stdout).toContain('"componentFile"');
      expect(stdout).toContain('"resolvedPath": "src/components/HeroBanner.tsx"');
      expect(stdout).toContain('"resolverReferences"');
      expect(stdout).toContain('"parentUsageSite"');
    } finally {
      await wrapperFixture.cleanup();
    }
  });

  // ── --model ───────────────────────────────────────────────────────────────

  it('--model accepts an arbitrary model name (dry-run so no agent call needed)', async () => {
    const { code } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--model',
        'claude-opus-4-5',
        '--dry-run',
      ],
      baseEnv(),
    );
    expect(code).toBe(0);
  });

  // ── Nonexistent agent binary ──────────────────────────────────────────────

  it('fails when --agent references a nonexistent binary', async () => {
    const dbOnlyEnv = {
      EDS_PIPELINE_DB_PATH: fixture.dbPath,
      NODE_NO_WARNINGS: '1',
    };
    const { code } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'experiences-test-nonexistent-agent-xyz', '--session', fixture.sessionId],
      dbOnlyEnv,
    );
    expect(code).not.toBe(0);
  });

  // ── Invalid --session ─────────────────────────────────────────────────────

  it('fails with an invalid --session id', async () => {
    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', 'nonexistent-session-id-xyz'],
      baseEnv(),
    );
    expect(code).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});

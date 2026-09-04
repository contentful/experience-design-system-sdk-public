import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openPipelineDb,
  storeRawComponents,
  getOrCreateSession,
  createStep,
  updateStep,
  loadCDFComponents,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';
import { HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON } from '@contentful/experience-design-system-extraction';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const RAW_COMPONENTS: RawComponentDefinition[] = [
  {
    name: 'Button',
    source: '/fake/src/Button.tsx',
    framework: 'react',
    props: [{ name: 'label', type: 'string', required: true, category: 'content' }],
    slots: [],
  },
];

async function seedDb(dbPath: string, components = RAW_COMPONENTS): Promise<string> {
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, {
    command: 'analyze extract',
  });
  storeRawComponents(db, sessionId, components);
  const stepId = createStep(db, sessionId, 'analyze extract', {
    project: '/fake',
  });
  updateStep(db, stepId, 'complete', { sessionId });
  db.close();
  return sessionId;
}

/** Run the CLI with a seeded DB and optionally a fake agent binary in PATH */
async function run(
  args: string[],
  fakeAgentScript?: string,
  fakeAgentName = 'claude',
  sessionId?: string,
): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
  dbPath: string;
}> {
  const fakeBinDir = await createTempDir('fake-bin-');
  const dbDir = await createTempDir('gen-db-');
  const dbPath = join(dbDir, 'pipeline.db');

  if (!sessionId) {
    sessionId = await seedDb(dbPath);
  }

  if (fakeAgentScript) {
    await symlink(fakeAgentScript, join(fakeBinDir, fakeAgentName));
  }

  const env = {
    ...process.env,
    PATH: `${fakeBinDir}:${process.env.PATH}`,
    EDS_PIPELINE_DB_PATH: dbPath,
  };

  // Inject --session into component-related args if not already present
  const finalArgs = args.includes('--session') ? args : injectSession(args, sessionId);

  return new Promise((res) => {
    execFile('node', [bin, ...finalArgs], { env }, (error, stdout, stderr) => {
      res({
        stdout,
        stderr,
        code: error?.code ? Number(error.code) : 0,
        dbPath,
      });
    });
  });
}

function injectSession(args: string[], sessionId: string): string[] {
  // Only inject for generate components subcommand (not tokens, not --help, not error cases that test missing args)
  const isComponentsCmd = args.includes('components') && !args.includes('tokens');
  if (!isComponentsCmd) return args;
  // Don't inject if testing for error cases that don't need a session
  const testsMissingAgent =
    args.includes('--raw-components') || (!args.includes('--agent') && !args.includes('tokens'));
  if (testsMissingAgent) return args;
  return [...args, '--session', sessionId];
}

describe('generate command — help', () => {
  it('prints subcommands with --help', async () => {
    const { stdout, code } = await run(['generate', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('components');
    expect(stdout).toContain('tokens');
  });

  it('prints components help with --help', async () => {
    const { stdout, code } = await run(['generate', 'components', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--agent');
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--dry-run');
    expect(stdout).not.toContain('--out');
  });

  it('prints tokens help with --help', async () => {
    const { stdout, code } = await run(['generate', 'tokens', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--agent');
    expect(stdout).toContain('--raw-tokens');
    expect(stdout).toContain('--dry-run');
    expect(stdout).not.toContain('--out');
  });
});

describe('generate components — input validation', () => {
  it('exits 1 when --agent is an unrecognised value', async () => {
    const dbDir = await createTempDir('gen-no-agent-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath);

    const env = { ...process.env, EDS_PIPELINE_DB_PATH: dbPath };
    const { stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'foo', '--session', sid],
        { env },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(1);
    expect(stderr).toContain('no agent configured');
  });

  it('exits 1 when --tokens path does not exist', async () => {
    const dbDir = await createTempDir('gen-no-tokens-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath);

    const env = { ...process.env, EDS_PIPELINE_DB_PATH: dbPath };
    const { stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid, '--tokens', '/no/such/tokens.json'],
        { env },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(1);
    expect(stderr).toContain('file not found');
  });

  it('exits 1 when --out is passed (flag removed)', async () => {
    const dbDir = await createTempDir('gen-out-removed-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath);

    const env = { ...process.env, EDS_PIPELINE_DB_PATH: dbPath };
    const { stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid, '--out', '/some/path'],
        { env },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(1);
    expect(stderr).toContain("unknown option '--out'");
  });
});

describe('generate tokens — input validation', () => {
  it('exits 1 when --raw-tokens is missing', async () => {
    const { stderr, code } = await run(['generate', 'tokens', '--agent', 'claude']);
    expect(code).toBe(1);
    expect(stderr).toContain('--raw-tokens is required');
  });
});

describe('generate components — --dry-run', () => {
  it('prints the prompt and exits 0 without invoking agent', async () => {
    const dbDir = await createTempDir('gen-dry-run-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath);

    const env = { ...process.env, EDS_PIPELINE_DB_PATH: dbPath };
    const { stdout, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid, '--dry-run'],
        { env },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(0);
    expect(stdout).toContain('AUTONOMOUS mode');
    expect(stdout).toContain('classify_prop');
  });

  it('inlines a sibling file so token linkage defined outside the component file is visible to the classify prompt', async () => {
    const srcDir = await createTempDir('gen-dry-run-src-');
    const componentPath = join(srcDir, 'Avatar.tsx');
    const utilsPath = join(srcDir, 'utils.ts');
    await writeFile(componentPath, `import { avatarColorMap } from './utils';\n`);
    await writeFile(utilsPath, 'export const avatarColorMap = { primary: "blue500" };');

    const dbDir = await createTempDir('gen-dry-run-sibling-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath, [
      {
        name: 'Avatar',
        source: componentPath,
        framework: 'react',
        props: [{ name: 'colorVariant', type: 'string', required: false, category: 'design' }],
        slots: [],
      },
    ]);

    const env = { ...process.env, EDS_PIPELINE_DB_PATH: dbPath };
    const { stdout, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid, '--dry-run'],
        { env },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(0);
    expect(stdout).toContain('Component source references');
    expect(stdout).toContain('export const avatarColorMap = { primary: "blue500" };');
  });

  it('inlines a sibling file with a plain-semantic-name Record lookup, not just token-looking string keys', async () => {
    const srcDir = await createTempDir('gen-dry-run-pillnext-src-');
    const componentPath = join(srcDir, 'PillNext.tsx');
    const stylesPath = join(srcDir, 'PillNext.styles.ts');
    await writeFile(componentPath, `import { variantStyles } from './PillNext.styles';\n`);
    await writeFile(
      stylesPath,
      [
        'export const variantStyles = {',
        '  neutral: { background: tokens.gray300 },',
        '  positive: { background: tokens.green300 },',
        '  negative: { background: tokens.red300 },',
        '  warning: { background: tokens.yellow300 },',
        '};',
      ].join('\n'),
    );

    const dbDir = await createTempDir('gen-dry-run-pillnext-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath, [
      {
        name: 'PillNext',
        source: componentPath,
        framework: 'react',
        props: [
          {
            name: 'variant',
            type: "'neutral' | 'positive' | 'negative' | 'warning'",
            required: false,
            category: 'design',
          },
        ],
        slots: [],
      },
    ]);

    const env = { ...process.env, EDS_PIPELINE_DB_PATH: dbPath };
    const { stdout, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid, '--dry-run'],
        { env },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(0);
    expect(stdout).toContain('Component source references');
    expect(stdout).toContain('imported file');
    expect(stdout).toContain('variantStyles');
    expect(stdout).toContain('tokens.gray300');
  });

  it('inlines a second-hop sibling reached through a first-hop sibling component (Tag re-exporting PillNext.variant)', async () => {
    const srcDir = await createTempDir('gen-dry-run-tag-src-');
    const tagPath = join(srcDir, 'Tag.tsx');
    const pillNextPath = join(srcDir, 'PillNext.tsx');
    const pillNextStylesPath = join(srcDir, 'PillNext.styles.ts');
    await writeFile(tagPath, `import { PillNext } from './PillNext';\n`);
    await writeFile(pillNextPath, `import { tagVariantResolutionMap } from './PillNext.styles';\n`);
    await writeFile(
      pillNextStylesPath,
      'export const tagVariantResolutionMap = { alpha: tokens.zzzSecondHopMarkerColor901, beta: tokens.zzzSecondHopMarkerColor902 };',
    );

    const dbDir = await createTempDir('gen-dry-run-tag-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath, [
      {
        name: 'Tag',
        source: tagPath,
        framework: 'react',
        props: [{ name: 'variant', type: "'alpha' | 'beta'", required: false, category: 'design' }],
        slots: [],
      },
    ]);

    const env = { ...process.env, EDS_PIPELINE_DB_PATH: dbPath };
    const { stdout, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid, '--dry-run'],
        { env },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(0);
    expect(stdout).toContain('Component source references');
    expect(stdout).toContain('tagVariantResolutionMap');
    expect(stdout).toContain('zzzSecondHopMarkerColor901');
  });
});

describe('generate components — agent binary not found', () => {
  it('prints fallback instructions when agent is not in PATH', async () => {
    const fakeBinDir = await createTempDir('fake-which-bin-');
    const fakeWhich = join(fakeBinDir, 'which');
    await writeFile(fakeWhich, '#!/bin/sh\nexit 1\n');
    await chmod(fakeWhich, 0o755);

    const dbDir = await createTempDir('gen-no-bin-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath);

    const { stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            EDS_PIPELINE_DB_PATH: dbPath,
          },
        },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(1);
    expect(stderr).toContain('not found in $PATH');
    expect(stderr).toContain('generate-components.md');
  });
});

describe('generate components — tool-call protocol output', () => {
  it('processes tool-call lines, stores classifications in DB, exits 0', async () => {
    const dbDir = await createTempDir('gen-success-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath);

    const fakeBinDir = await createTempDir('fake-bin-success-');
    await symlink(
      join(resolve(import.meta.dirname, '../fixtures/generate'), 'fake-agent-success.mjs'),
      join(fakeBinDir, 'claude'),
    );

    const { code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            EDS_PIPELINE_DB_PATH: dbPath,
          },
        },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(0);

    const db = openPipelineDb(dbPath);
    const stored = loadCDFComponents(db, sid);
    db.close();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored[0]?.key).toBe('Button');
    expect(stored[0]?.entry.$properties['label']?.$type).toBe('string');
  });

  it('classifies Avatar.colorVariant as enum — friendly names win over 1:1 token backing', async () => {
    const dbDir = await createTempDir('gen-avatar-enum-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath, [
      {
        name: 'Avatar',
        source: '/fake/src/Avatar.tsx',
        framework: 'react',
        props: [{ name: 'colorVariant', type: 'string', required: false, category: 'design' }],
        slots: [],
      },
    ]);

    const friendlyNames = [
      'primary',
      'muted',
      'green',
      'orange',
      'yellow',
      'purple',
      'gray',
      'pink',
      'emerald',
      'lavender',
    ];
    const toolCallLines = [
      { tool: 'classify_component', description: 'An avatar component' },
      {
        tool: 'classify_prop',
        prop: 'colorVariant',
        cdf_type: 'enum',
        cdf_category: 'design',
        values: friendlyNames,
        description: 'Named color variant',
      },
    ];

    const fakeBinDir = await createTempDir('fake-bin-avatar-enum-');
    const fakeAgent = join(fakeBinDir, 'claude');
    await writeFile(
      fakeAgent,
      `#!/usr/bin/env node\n${toolCallLines
        .map((call) => `process.stdout.write(${JSON.stringify(`${JSON.stringify(call)}\n`)});`)
        .join('\n')}\nprocess.exit(0);\n`,
    );
    await chmod(fakeAgent, 0o755);

    const { code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            EDS_PIPELINE_DB_PATH: dbPath,
          },
        },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(0);

    const db = openPipelineDb(dbPath);
    const stored = loadCDFComponents(db, sid);
    db.close();
    const avatar = stored.find((c) => c.key === 'Avatar');
    const colorVariant = avatar?.entry.$properties['colorVariant'];
    expect(colorVariant?.$type).toBe('enum');
    expect(colorVariant?.$values).toEqual(friendlyNames);
    expect(colorVariant?.['$token.kind']).toBeUndefined();
    expect(colorVariant?.['$token.allowed']).toBeUndefined();
  });

  it('classifies Section — token-typed layout props alongside enum-typed variant props on the same component', async () => {
    const dbDir = await createTempDir('gen-section-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath, [
      {
        name: 'Section',
        source: '/fake/src/Section.tsx',
        framework: 'react',
        props: [
          { name: 'direction', type: "'row' | 'column'", required: false, category: 'design' },
          { name: 'itemAlign', type: "'start' | 'center' | 'end' | 'stretch'", required: false, category: 'design' },
          { name: 'gap', type: 'string', required: false, category: 'design' },
          { name: 'verticalSpacing', type: 'string', required: false, category: 'design' },
          { name: 'horizontalSpacing', type: 'string', required: false, category: 'design' },
          { name: 'backgroundColor', type: 'string', required: false, category: 'design' },
          { name: 'color', type: 'string', required: false, category: 'design' },
          { name: 'radius', type: 'string', required: false, category: 'design' },
        ],
        slots: [],
      },
    ]);

    const toolCallLines = [
      { tool: 'classify_component', description: 'A flex/grid layout primitive' },
      {
        tool: 'classify_prop',
        prop: 'direction',
        cdf_type: 'enum',
        cdf_category: 'design',
        values: ['row', 'column'],
        description: 'Flex direction',
      },
      {
        tool: 'classify_prop',
        prop: 'itemAlign',
        cdf_type: 'enum',
        cdf_category: 'design',
        values: ['start', 'center', 'end', 'stretch'],
        description: 'Cross-axis alignment',
      },
      { tool: 'classify_prop', prop: 'gap', cdf_type: 'token', cdf_category: 'design', token_kind: 'dimension' },
      {
        tool: 'classify_prop',
        prop: 'verticalSpacing',
        cdf_type: 'token',
        cdf_category: 'design',
        token_kind: 'dimension',
      },
      {
        tool: 'classify_prop',
        prop: 'horizontalSpacing',
        cdf_type: 'token',
        cdf_category: 'design',
        token_kind: 'dimension',
      },
      {
        tool: 'classify_prop',
        prop: 'backgroundColor',
        cdf_type: 'token',
        cdf_category: 'design',
        token_kind: 'color',
      },
      { tool: 'classify_prop', prop: 'color', cdf_type: 'token', cdf_category: 'design', token_kind: 'color' },
      { tool: 'classify_prop', prop: 'radius', cdf_type: 'token', cdf_category: 'design', token_kind: 'dimension' },
    ];

    const fakeBinDir = await createTempDir('fake-bin-section-');
    const fakeAgent = join(fakeBinDir, 'claude');
    await writeFile(
      fakeAgent,
      `#!/usr/bin/env node\n${toolCallLines
        .map((call) => `process.stdout.write(${JSON.stringify(`${JSON.stringify(call)}\n`)});`)
        .join('\n')}\nprocess.exit(0);\n`,
    );
    await chmod(fakeAgent, 0o755);

    const { code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            EDS_PIPELINE_DB_PATH: dbPath,
          },
        },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(0);

    const db = openPipelineDb(dbPath);
    const stored = loadCDFComponents(db, sid);
    db.close();
    const section = stored.find((c) => c.key === 'Section');
    const props = section?.entry.$properties ?? {};

    for (const name of ['direction', 'itemAlign']) {
      expect(props[name]?.$type).toBe('enum');
      expect(props[name]?.$values).toBeDefined();
      expect(props[name]?.['$token.kind']).toBeUndefined();
    }
    for (const name of ['gap', 'verticalSpacing', 'horizontalSpacing', 'backgroundColor', 'color', 'radius']) {
      expect(props[name]?.$type).toBe('token');
      expect(props[name]?.['$token.kind']).toBeDefined();
      expect(props[name]?.$values).toBeUndefined();
    }
  });

  it('preserves accepted data-fetch wrappers for generation', async () => {
    const dbDir = await createTempDir('gen-wrapper-guard-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath, [
      ...RAW_COMPONENTS,
      {
        name: 'HeroBannerGql',
        source: '/fake/src/HeroBannerGql.tsx',
        framework: 'react',
        props: [
          { name: 'id', type: 'string', required: true },
          { name: 'locale', type: 'string', required: true },
          { name: 'preview', type: 'boolean', required: true },
        ],
        slots: [],
        reviewReasons: [HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON, 'data-wrapper:generated-query-hook'],
        needsReview: true,
        extractionConfidence: 2,
      },
    ]);

    const fakeBinDir = await createTempDir('fake-bin-wrapper-guard-');
    const fakeAgent = join(fakeBinDir, 'claude');
    await writeFile(
      fakeAgent,
      `#!/usr/bin/env node
process.stdout.write('{"tool":"classify_component","description":"Generated component"}\\n');
process.stdout.write('{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true,"description":"Label"}\\n');
process.stdout.write('{"tool":"classify_prop","prop":"id","cdf_type":"string","cdf_category":"state","required":true,"description":"Identifier"}\\n');
process.exit(0);
`,
    );
    await chmod(fakeAgent, 0o755);

    const { stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            EDS_PIPELINE_DB_PATH: dbPath,
          },
        },
        (err, stdout, innerStderr) =>
          res({
            stdout,
            stderr: innerStderr,
            code: err?.code ? Number(err.code) : 0,
          }),
      );
    });
    expect(code).toBe(0);
    expect(stderr).not.toContain('skipped 1 high-confidence data-fetch wrapper');

    const db = openPipelineDb(dbPath);
    const stored = loadCDFComponents(db, sid);
    db.close();
    expect(stored.map((component) => component.key).sort()).toEqual(['Button', 'HeroBannerGql']);
  });

  it('exits 1 when agent exits non-zero', async () => {
    const dbDir = await createTempDir('gen-nonzero-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath);

    const fakeBinDir = await createTempDir('fake-bin-nonzero-');
    await symlink(
      join(resolve(import.meta.dirname, '../fixtures/generate'), 'fake-agent-non-zero.mjs'),
      join(fakeBinDir, 'claude'),
    );

    const { stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            EDS_PIPELINE_DB_PATH: dbPath,
            EDS_RETRY_BACKOFF_MS: '0',
          },
        },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(1);
    expect(stderr).toContain('agent exited with code');
  }, 30_000);

  it('exits 1 when agent produces no tool calls', async () => {
    const dbDir = await createTempDir('gen-no-calls-db-');
    const dbPath = join(dbDir, 'pipeline.db');
    const sid = await seedDb(dbPath);

    const fakeBinDir = await createTempDir('fake-bin-no-calls-');
    await symlink(
      join(resolve(import.meta.dirname, '../fixtures/generate'), 'fake-agent-no-tool-calls.mjs'),
      join(fakeBinDir, 'claude'),
    );

    const { stderr, code } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>((res) => {
      execFile(
        'node',
        [bin, 'generate', 'components', '--agent', 'claude', '--session', sid],
        {
          env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            EDS_PIPELINE_DB_PATH: dbPath,
            EDS_RETRY_BACKOFF_MS: '0',
          },
        },
        (err, stdout, stderr) => res({ stdout, stderr, code: err?.code ? Number(err.code) : 0 }),
      );
    });
    expect(code).toBe(1);
    expect(stderr).toContain('no tool calls');
  }, 30_000);
});

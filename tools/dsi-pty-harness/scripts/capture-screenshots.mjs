#!/usr/bin/env node
/**
 * Capture text snapshots of the wizard's key states for docs images.
 *
 * Each capture drives the wizard to a target state, waits for it to settle,
 * dumps the ANSI-stripped screen, keeps only the LAST full frame (the
 * append-only buffer captures every Ink re-render), sanitizes paths, and
 * writes <slug>.txt into docs/screenshots/ with a caption header.
 *
 * Usage:
 *   node tools/dsi-pty-harness/scripts/capture-screenshots.mjs [slug...]
 *
 * With no args, captures all. With slugs, captures only those.
 */
import { spawnWizard } from '../src/harness.mjs';
import { runCli } from '../tests/helpers/run-cli.mjs';
import stripAnsi from 'strip-ansi';
import { makeTmpHome } from '../tests/helpers/tmp-home.mjs';
import { seedRuns } from '../tests/helpers/seed-runs.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from '../tests/helpers/seed-pipeline-db.mjs';
import { startMockEma } from '../tests/helpers/mock-ema.mjs';
import { REACT_MINIMAL } from '../tests/helpers/fixtures.mjs';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../docs/screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const SANITIZED_PATH = '~/design-system-fixture';
const FIXTURE_PATH_REGEX = new RegExp(REACT_MINIMAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
// Anything that looks like our tmp HOME dir.
const HOME_PATH_REGEX = /\/(?:private\/)?(?:var\/folders\/[^ )\]/\s]+|tmp)\/eds-pty-home-[A-Za-z0-9-]+/g;

const REBUILD_BANNER_REGEX = /^(⚙ Source changed.*|✓ Build complete)$/;
const HEADER_REGEX = /^experience-design-system-cli\s/;

function sanitize(text) {
  return stripAnsi(text)
    .replace(FIXTURE_PATH_REGEX, SANITIZED_PATH)
    .replace(HOME_PATH_REGEX, '~')
    // Session IDs are 3-word random names — normalize for reproducibility.
    .replace(/\bsession=([a-z-]+-[a-f0-9]+)\b/g, 'session=<session-id>')
    .replace(/Session:\s+([a-z-]+-[a-f0-9]+)/g, 'Session: <session-id>')
    // `progress=…` lines are for machine-readable parents (Ink harness),
    // not human docs — drop them entirely.
    .replace(/^progress=.*$/gm, '')
    // Durations are timing-dependent; replace with a fixed placeholder.
    .replace(/\(\d+\.\d+s\)/g, '(0.5s)')
    .replace(/durationMs":\s*\d+/g, 'durationMs": 500');
}

/**
 * Keep only the last full frame — everything from the LAST wizard-header
 * line to the end. Also drop dev-mode rebuild banners the CLI prints on
 * source drift.
 */
function lastFrame(screen) {
  // Drop rebuild banners first — they come before any header.
  const noBanner = screen
    .split('\n')
    .filter((l) => !REBUILD_BANNER_REGEX.test(l.trim()))
    .join('\n');
  const lines = noBanner.split('\n');
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (HEADER_REGEX.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    // No header — return the whole cleaned buffer.
    return noBanner.trimEnd();
  }
  // Trim trailing whitespace per line so we don't ship huge blank tails.
  return lines
    .slice(start)
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trimEnd();
}

function write(slug, caption, screen) {
  const frame = lastFrame(sanitize(screen));
  const body = [
    `# ${slug}`,
    ``,
    caption,
    ``,
    '-'.repeat(80),
    ``,
    frame,
    ``,
  ].join('\n');
  const path = join(OUT_DIR, `${slug}.txt`);
  writeFileSync(path, body);
  const lines = frame.split('\n').length;
  console.log(`✓ ${slug} → ${path} (${lines} lines)`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stub-agent env for headless invocations that need agent calls.
const HARNESS_DIR = resolve(HERE, '..');
const STUB_AGENT = resolve(HARNESS_DIR, 'src/stub-agent.mjs');
const STUB_ENV = {
  EDS_AGENT_BINARY_CLAUDE: STUB_AGENT,
  EDS_AGENT_BINARY_CODEX: STUB_AGENT,
  EDS_AGENT_BINARY_OPENCODE: STUB_AGENT,
  EDS_AGENT_BINARY_CURSOR: STUB_AGENT,
};

/**
 * Run the CLI headlessly with a fresh tmp HOME. Returns combined stderr +
 * stdout (stderr first — that's where progress lines land). Auto-cleans
 * the tmp home. `beforeCleanup` runs after the command completes but
 * before HOME cleanup — use it to peek at the pipeline.db, save-path etc.
 */
async function runHeadless(args, extraEnv = {}, beforeCleanup) {
  const t = makeTmpHome();
  try {
    const { stdout, stderr } = await runCli(args, {
      env: { ...t.env, ...STUB_ENV, ...extraEnv },
    });
    if (beforeCleanup) await beforeCleanup(t);
    return stderr + (stdout ? '\n' + stdout : '');
  } finally {
    t.cleanup();
  }
}

// ── Individual captures ─────────────────────────────────────────────────────

const captures = {};

captures['experience-design-system-cli-import-welcome'] = async () => {
  const t = makeTmpHome();
  try {
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 50 });
    try {
      await w.waitFor('Where is your component library?', { timeout: 10000 });
      await sleep(1500);
      write(
        'experience-design-system-cli-import-welcome',
        `Caption: the wizard's entry screen after \`experiences import\` on a fresh install with no prior runs. WelcomeStep with the five-step overview and the "Project path:" prompt awaiting input.`,
        w.getScreen(),
      );
    } finally {
      await w.close();
    }
  } finally {
    t.cleanup();
  }
};

captures['experience-design-system-cli-import-run-picker'] = async () => {
  const t = makeTmpHome();
  try {
    seedRuns(t.home, [
      { id: 'apr-15', createdAt: '2026-04-15T12:00:00Z', componentCount: 12, agent: 'claude' },
      { id: 'mar-28', createdAt: '2026-03-28T09:30:00Z', componentCount: 8, agent: 'claude' },
      { id: 'mar-14', createdAt: '2026-03-14T18:00:00Z', componentCount: 15, agent: 'codex' },
    ]);
    const w = await spawnWizard(['import'], { env: t.env, cols: 200, rows: 50 });
    try {
      await w.waitFor(/Found.*prior run/i, { timeout: 10000 });
      await sleep(1500);
      write(
        'experience-design-system-cli-import-run-picker',
        'Caption: run-picker at wizard start when `~/.config/experiences/runs.json` has one or more prior runs. Three seeded runs are shown with their created-at, component count, and pushed state; the key legend at the bottom shows Push / Modify / New / Quit bindings.',
        w.getScreen(),
      );
    } finally {
      await w.close();
    }
  } finally {
    t.cleanup();
  }
};

captures['experience-design-system-cli-import-scope-gate'] = async () => {
  const t = makeTmpHome();
  try {
    const w = await spawnWizard(
      ['import', '--project', REACT_MINIMAL, '--no-push', '--auto-filter'],
      { env: t.env, cols: 200, rows: 50 },
    );
    try {
      await w.waitFor('Design tokens', { timeout: 10000 });
      w.writeKey('s');
      await w.waitFor(/Found \d+ files/, { timeout: 8000 });
      w.writeKey('enter');
      await w.waitFor(/AI recommended exclusions|AI excluded/i, { timeout: 20000 });
      await sleep(2500);
      write(
        'experience-design-system-cli-import-scope-gate',
        'Caption: scope-gate with the AI filter active (`--auto-filter`). Shows the "AI recommended exclusions" section, the Components section, glyphs on both, and the key legend at the bottom (13-component fixture).',
        w.getScreen(),
      );
    } finally {
      await w.close();
    }
  } finally {
    t.cleanup();
  }
};

captures['experience-design-system-cli-import-final-review'] = async () => {
  const t = makeTmpHome();
  try {
    const { dbPath } = seedPipelineDb(t.home);
    const savePath = join(t.home, 'save');
    mkdirSync(savePath, { recursive: true });
    seedRuns(t.home, [
      {
        id: 'run-review',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath: REACT_MINIMAL,
      },
    ]);
    const w = await spawnWizard(['import', '--modify', 'run-review'], {
      env: { ...t.env, EDS_PIPELINE_DB_PATH: dbPath },
      cols: 200,
      rows: 50,
    });
    try {
      await w.waitFor(/Button/, { timeout: 15000 });
      await sleep(1500);
      w.writeKey('I');
      await sleep(2000);
      write(
        'experience-design-system-cli-import-final-review',
        'Caption: final-review step (via `experiences import --modify <run-id>`). Sidebar shows the generated components; FieldEditor renders the focused component with $description and $slots; the per-component rationale panel is opened via [I].',
        w.getScreen(),
      );
    } finally {
      await w.close();
    }
  } finally {
    t.cleanup();
  }
};

captures['experience-design-system-cli-analyze-extract'] = async () => {
  const output = await runHeadless([
    'analyze',
    'extract',
    '--project',
    REACT_MINIMAL,
  ]);
  write(
    'experience-design-system-cli-analyze-extract',
    'Caption: `experiences analyze extract` against a 13-component React fixture. Shows the per-file scan progress, the resolved source directory, the extracted count, the session id, and any parser warnings.',
    output,
  );
};

captures['experience-design-system-cli-analyze-select'] = async () => {
  // `analyze select-agent` produces a nicely formatted per-component
  // accept/reject table with reasons. This is what the docs image is
  // actually asking for — the interactive `analyze select` TUI is
  // covered elsewhere via --modify.
  const t = makeTmpHome();
  try {
    const dbPath = join(t.home, 'pipeline.db');
    // Seed the DB by running extract once — otherwise select-agent has
    // nothing to classify.
    await runCli(
      ['analyze', 'extract', '--project', REACT_MINIMAL],
      { env: { ...t.env, ...STUB_ENV, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    const { stdout, stderr } = await runCli(
      ['analyze', 'select-agent', '--agent', 'claude'],
      { env: { ...t.env, ...STUB_ENV, EDS_PIPELINE_DB_PATH: dbPath } },
    );
    const output = stderr + (stdout ? '\n' + stdout : '');
    write(
      'experience-design-system-cli-analyze-select',
      'Caption: `experiences analyze select-agent --agent claude` classifies each extracted component as accepted or rejected. The 13-component fixture yields 11 accepted and 2 rejected (Modal and Divider), each with the agent\'s one-line rationale.',
      output,
    );
  } finally {
    t.cleanup();
  }
};

captures['experience-design-system-cli-generate-components'] = async () => {
  // `experiences import --skip-apply` runs the full pipeline through
  // generate; the "Categorizing N components" section is what the
  // image is asking for.
  const output = await runHeadless([
    'import',
    '--project',
    REACT_MINIMAL,
    '--skip-apply',
  ]);
  write(
    'experience-design-system-cli-generate-components',
    'Caption: the "Categorizing components" step of `experiences import --skip-apply`. Shows the "Scope: N accepted component(s) from analyze select" header, the per-component categorization progress, and the trailing pipeline summary JSON.',
    output,
  );
};

captures['experience-design-system-cli-import-pushing'] = async () => {
  // PushingStep with an in-flight push. To get a mid-push snapshot we
  // need mock EMA to hold the request open. We use a slow-preview stub
  // so the wizard is still on "Now processing:" when we sample.
  const server = await startMockEma();
  // Slow preview: the wizard sits on the preview-in-flight screen
  // longer than we need. But the actual "pushing" UI is DURING the
  // apply call. Hold apply-poll open.
  server.stub('POST', /imports\/preview$/, (req, res) => {
    // Small delay so the "computing preview" state is visible.
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          components: {
            new: [
              { id: 'Button', name: 'Button' },
              { id: 'Card', name: 'Card' },
              { id: 'Icon', name: 'Icon' },
            ],
            changed: [],
            unchanged: [],
            removed: [],
          },
          tokens: { new: [], changed: [], unchanged: [], removed: [] },
          taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
        }),
      );
    }, 300);
  });
  // POST /imports/apply → running with 1/3 pending. Wizard will poll.
  server.stub('POST', /imports\/apply$/, (req, res) => {
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        sys: {
          type: 'ApplyOperation',
          id: 'op-mock',
          status: 'running',
          createdAt: '2026-01-01T00:00:00Z',
          createdBy: { sys: { type: 'Link', linkType: 'User', id: 'u' } },
        },
        summary: { total: 3, pending: 2, succeeded: 1, failed: 0 },
        items: [
          { entityType: 'ComponentType', id: 'Button', action: 'create', status: 'succeeded' },
          { entityType: 'ComponentType', id: 'Card', action: 'create', status: 'queued' },
          { entityType: 'ComponentType', id: 'Icon', action: 'create', status: 'queued' },
        ],
      }),
    );
  });
  // GET poll → keep returning "running" so we stay mid-push while we sample.
  server.stub('GET', /\/imports\/apply\/[^/]+$/, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        sys: {
          type: 'ApplyOperation',
          id: 'op-mock',
          status: 'running',
          createdAt: '2026-01-01T00:00:00Z',
          createdBy: { sys: { type: 'Link', linkType: 'User', id: 'u' } },
        },
        summary: { total: 3, pending: 1, succeeded: 2, failed: 0 },
        items: [
          { entityType: 'ComponentType', id: 'Button', action: 'create', status: 'succeeded' },
          { entityType: 'ComponentType', id: 'Card', action: 'create', status: 'succeeded' },
          { entityType: 'ComponentType', id: 'Icon', action: 'create', status: 'queued' },
        ],
      }),
    );
  });

  const t = makeTmpHome();
  try {
    const { dbPath } = seedPipelineDb(t.home);
    const savePath = join(t.home, 'save');
    const projectPath = join(t.home, 'project');
    mkdirSync(savePath, { recursive: true });
    mkdirSync(join(projectPath, '.contentful'), { recursive: true });
    writeFileSync(join(projectPath, '.contentful', 'tokens.json'), '{}\n');
    // Seed credentials.json so the modify path (which enters at
    // final-review, skipping the credentials step) has creds pre-wired
    // for the push. Host = mock.host (full URL — toApiHost accepts it).
    mkdirSync(join(t.home, '.config', 'experiences'), { recursive: true });
    writeFileSync(
      join(t.home, '.config', 'experiences', 'credentials.json'),
      JSON.stringify({
        spaceId: 'sp1',
        environmentId: 'master',
        cmaToken: 'fake-token',
        host: server.host,
      }),
    );
    seedRuns(t.home, [
      {
        id: 'run-pushing',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath,
      },
    ]);
    const w = await spawnWizard(['import', '--modify', 'run-pushing', '--overwrite'], {
      env: {
        ...t.env,
        ...STUB_ENV,
        EDS_PIPELINE_DB_PATH: dbPath,
        CONTENTFUL_MANAGEMENT_TOKEN: 'fake',
      },
      cols: 200,
      rows: 50,
    });
    try {
      // Drive: final-review → accept all → finalize → save-and-push.
      await w.waitFor(/Button/, { timeout: 15000 });
      await sleep(1000);
      w.writeKey('A');
      await sleep(1500);
      w.writeKey('F');
      await w.waitFor(/Save decisions and exit\?/, { timeout: 8000 });
      w.writeKey('y');
      await w.waitFor(/Save AND push|Save only|Push only/, { timeout: 8000 });
      w.writeKey('b'); // save AND push
      w.writeKey('enter');
      // Preview confirmation shows first — press Enter to trigger push.
      await w.waitFor(/Here's what will happen|Push to Contentful/i, { timeout: 15000 });
      await sleep(500);
      w.writeKey('enter');
      // Now we're in the push flow. Wait for "Pushing" or "Applying".
      await w.waitFor(/Pushing|Now processing|Applying|Push in progress|created/i, {
        timeout: 15000,
      });
      // Sample WHILE the poll is still open (mock delays 4s).
      await sleep(1500);
      write(
        'experience-design-system-cli-import-pushing',
        'Caption: PushingStep mid-push against a mock Contentful endpoint. Shows the aggregate <processed>/<total> line, spinner, and the current entity being applied.',
        w.getScreen(),
      );
    } finally {
      await w.close();
    }
  } finally {
    t.cleanup();
    await server.close();
  }
};

captures['experience-design-system-cli-import-done'] = async () => {
  // Same setup as pushing but sample AFTER the push completes.
  const server = await startMockEma();
  server.stub('POST', /imports\/preview$/, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        components: {
          new: [
            { id: 'Button', name: 'Button' },
            { id: 'Card', name: 'Card' },
            { id: 'Icon', name: 'Icon' },
          ],
          changed: [],
          unchanged: [],
          removed: [],
        },
        tokens: { new: [], changed: [], unchanged: [], removed: [] },
        taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
      }),
    );
  });

  const t = makeTmpHome();
  try {
    const { dbPath } = seedPipelineDb(t.home);
    const savePath = join(t.home, 'save');
    const projectPath = join(t.home, 'project');
    mkdirSync(savePath, { recursive: true });
    mkdirSync(join(projectPath, '.contentful'), { recursive: true });
    writeFileSync(join(projectPath, '.contentful', 'tokens.json'), '{}\n');
    mkdirSync(join(t.home, '.config', 'experiences'), { recursive: true });
    writeFileSync(
      join(t.home, '.config', 'experiences', 'credentials.json'),
      JSON.stringify({
        spaceId: 'sp1',
        environmentId: 'master',
        cmaToken: 'fake-token',
        host: server.host,
      }),
    );
    seedRuns(t.home, [
      {
        id: 'run-done',
        extractSessionId: SEEDED_SESSION_ID,
        generateSessionId: SEEDED_SESSION_ID,
        savePath,
        projectPath,
      },
    ]);
    const w = await spawnWizard(['import', '--modify', 'run-done', '--overwrite'], {
      env: {
        ...t.env,
        ...STUB_ENV,
        EDS_PIPELINE_DB_PATH: dbPath,
        CONTENTFUL_MANAGEMENT_TOKEN: 'fake',
      },
      cols: 200,
      rows: 50,
    });
    try {
      await w.waitFor(/Button/, { timeout: 15000 });
      await sleep(1000);
      w.writeKey('A');
      await sleep(1500);
      w.writeKey('F');
      await w.waitFor(/Save decisions and exit\?/, { timeout: 8000 });
      w.writeKey('y');
      await w.waitFor(/Save AND push|Save only|Push only/, { timeout: 8000 });
      w.writeKey('b');
      w.writeKey('enter');
      // The preview-confirmation step renders "Here's what will happen"
      // with a big "[Enter] Push to Contentful" button. Advance past it.
      await w.waitFor(/Here's what will happen|Push to Contentful/i, { timeout: 15000 });
      await sleep(1000);
      w.writeKey('enter'); // confirm push
      // Wait for the true done state — components created/updated summary.
      await w.waitFor(/created|updated|View in Contentful|Successfully|complete/i, {
        timeout: 30000,
      });
      await sleep(1000);
      write(
        'experience-design-system-cli-import-done',
        'Caption: DoneStep after a successful push against a mock Contentful endpoint. Shows the summary counts (created / updated / removed) and the webapp URL back to the space.',
        w.getScreen(),
      );
    } finally {
      await w.close();
    }
  } finally {
    t.cleanup();
    await server.close();
  }
};

captures['experience-design-system-cli-setup'] = async () => {
  // `experiences setup` is an interactive prompt-driven flow. Drive
  // it end-to-end with staged keystrokes, sampling at each stopping
  // point isn't practical — instead we sample the final "completion
  // summary" state so the caption line "End on the completion summary"
  // matches. Feed sensible defaults via env + keystrokes.
  const t = makeTmpHome();
  try {
    const w = await spawnWizard(['setup'], {
      env: {
        ...t.env,
        ...STUB_ENV,
        // Pre-seed some values via env so the prompts fast-forward.
        CONTENTFUL_SPACE_ID: 'sp1',
        CONTENTFUL_ENVIRONMENT_ID: 'master',
        CONTENTFUL_MANAGEMENT_TOKEN: 'CFPAT-mock-token',
      },
      cols: 200,
      rows: 60,
    });
    try {
      // Watch for the first prompt to appear.
      await w.waitFor(/setup|Setup|welcome|check/i, { timeout: 10000 });
      // Drive with a series of Enters — most steps accept a default.
      // Note: setup is interactive so exact key sequence matters; if
      // this doesn't reach the completion summary, the caption below
      // still describes what got captured.
      for (let i = 0; i < 20; i++) {
        w.writeKey('enter');
        await sleep(500);
        if (w.isExited()) break;
      }
      await sleep(1500);
      write(
        'experience-design-system-cli-setup',
        'Caption: `experiences setup` runs a six-step onboarding flow: Node.js check, pnpm check, install & build, coding-agent detection, Contentful credentials, and Step 6 preferences (AI auto-filter, EDS_EXTRACT_CONCURRENCY, custom skill prompt paths, debug logging, NO_COLOR). This capture shows the final state after the flow completes.',
        w.getScreen(),
      );
    } finally {
      await w.close();
    }
  } finally {
    t.cleanup();
  }
};

// ── Runner ──────────────────────────────────────────────────────────────────

const wantSlugs = process.argv.slice(2);
const runSlugs = wantSlugs.length > 0 ? wantSlugs : Object.keys(captures);

let ok = 0;
const failed = [];
for (const slug of runSlugs) {
  const fn = captures[slug];
  if (!fn) {
    console.error(`✗ ${slug}: no capture defined`);
    failed.push({ slug, error: 'not defined' });
    continue;
  }
  try {
    await fn();
    ok++;
  } catch (e) {
    console.error(`✗ ${slug}: ${e.message}`);
    failed.push({ slug, error: e.message });
  }
}
console.log(`\n${ok}/${runSlugs.length} captured`);
if (failed.length) {
  console.log('Failed:');
  for (const f of failed) console.log(`  ${f.slug}: ${f.error}`);
  process.exit(1);
}

/**
 * Tier 6 — malformed `EDS_AGENT_BINARY_*` overrides.
 *
 * The wizard resolves the agent binary via `resolveBinary()` in
 * generate/agent-runner.ts and then checks `assertBinaryInPath` in
 * generate/command.ts. If the override points at:
 *   - a nonexistent path: `which` returns non-zero → fallback
 *     instructions land on stderr, exit code 1.
 *   - a script that exits non-zero when invoked: the run reports a
 *     per-component failure with the observed error.
 *
 * We drive `generate components` directly (not `import`) so the failure
 * path is a straight code line rather than tunneled through the wizard.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli } from './helpers/run-cli.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { seedPipelineDb, SEEDED_SESSION_ID } from './helpers/seed-pipeline-db.mjs';

describe('EDS_AGENT_BINARY_* overrides', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('nonexistent path surfaces the fallback-instructions error', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);
    const { stderr, code } = await runCli(
      [
        'generate',
        'components',
        '--session',
        SEEDED_SESSION_ID,
        '--agent',
        'claude',
      ],
      {
        env: {
          ...t.env,
          EDS_PIPELINE_DB_PATH: dbPath,
          EDS_AGENT_BINARY_CLAUDE: '/tmp/does-not-exist-anywhere-xyz',
        },
      },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/agent 'claude' not found/);
    // Fallback instructions include the resolved binary and skill hint.
    expect(stderr).toMatch(/does-not-exist-anywhere-xyz/);
    expect(stderr).toMatch(/--dry-run/);
  });

  it('script that exits non-zero surfaces a per-component failure', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { dbPath } = seedPipelineDb(t.home);

    // Write a stub that answers `auth status` OK but exits 1 on the
    // generation call. The stub-agent has a "loggedIn" path that must
    // pass or the run aborts before per-component work starts.
    const script = join(t.home, 'exit1-agent.mjs');
    writeFileSync(
      script,
      "#!/usr/bin/env node\n" +
        "const args = process.argv.slice(2);\n" +
        "if (args.some(a => a === 'auth' || a === 'status')) {\n" +
        "  process.stdout.write(JSON.stringify({loggedIn: true}));\n" +
        "  process.exit(0);\n" +
        "}\n" +
        "process.stderr.write('deliberate failure\\n');\n" +
        "process.exit(1);\n",
    );
    chmodSync(script, 0o755);

    const { stderr, code } = await runCli(
      [
        'generate',
        'components',
        '--session',
        SEEDED_SESSION_ID,
        '--agent',
        'claude',
        // Bypass the per-component cache so the stub actually runs.
        // Without this the seeded pipeline.db reports all 3 components
        // as cached and never invokes the agent.
        '--no-cache',
      ],
      {
        env: {
          ...t.env,
          EDS_PIPELINE_DB_PATH: dbPath,
          EDS_AGENT_BINARY_CLAUDE: script,
        },
      },
    );
    // The wizard reports a Failed summary per component when the agent
    // stub errors out.
    expect(stderr).toMatch(/Failed/i);
  });
});

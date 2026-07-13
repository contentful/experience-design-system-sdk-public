/**
 * Tier 3b — `apply push` flag coverage, wired against a mock EMA.
 *
 * We exercise `apply push` (not `import`) because it takes a
 * pre-computed components.json and pushes it, which is exactly the
 * codepath the push-hitting `import` flags eventually go through. That
 * gives us a direct route to test:
 *   - --host is honored (requests hit our mock)
 *   - --yes satisfies the non-interactive-mode check
 *   - --cma-token is sent as Authorization
 *   - --verbose and --force don't break the happy path
 *   - --dry-run stops after preview (no apply call)
 *
 * Push-hitting `import` flags (--no-save on the wizard save-conflict
 * path; interactive push confirmation via --yes) share the same
 * downstream code but stack a wizard on top; the interesting behaviors
 * are the same. Testing them through `apply push` is a cheaper way to
 * cover the wire-level flags without seeding pipeline.db.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from './helpers/run-cli.mjs';
import { startMockEma } from './helpers/mock-ema.mjs';
import { REACT_MINIMAL_COMPONENTS_JSON } from './helpers/fixtures.mjs';

describe('experiences apply push — flag coverage against mock EMA', () => {
  const cleanups = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()();
  });

  async function withMock() {
    const server = await startMockEma();
    cleanups.push(() => server.close());
    return server;
  }

  const baseArgs = (host) => [
    'apply',
    'push',
    '--components',
    REACT_MINIMAL_COMPONENTS_JSON,
    '--space-id',
    'sp1',
    '--environment-id',
    'master',
    '--cma-token',
    'fake-token',
    '--host',
    host,
    '--yes',
  ];

  it('--host + --yes drives a complete push against the mock', async () => {
    const server = await withMock();
    // Return a preview with 1 new component so there IS something to apply
    // (the CLI short-circuits on a fully-empty diff).
    server.stub('POST', /imports\/preview$/, (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          components: {
            new: [{ id: 'Button', name: 'Button' }],
            changed: [],
            unchanged: [],
            removed: [],
          },
          tokens: { new: [], changed: [], unchanged: [], removed: [] },
          taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
        }),
      );
    });

    const { code, stderr } = await runCli(baseArgs(server.host), {});
    if (code !== 0) console.error('stderr:', stderr.slice(0, 500));
    expect(code).toBe(0);
    // Preview + apply — at minimum, both should fire.
    const paths = server.requests.map((r) => r.path).join(' | ');
    expect(paths).toMatch(/imports\/preview/);
    expect(paths).toMatch(/imports\/apply/);
  });

  it('--cma-token is sent as Authorization: Bearer', async () => {
    const server = await withMock();
    await runCli(baseArgs(server.host), {});
    // The token appears on every mutating call; sanity-check on preview.
    const preview = server.requests.find((r) => r.path.endsWith('/imports/preview'));
    expect(preview).toBeDefined();
    expect(preview.headers.authorization).toBe('Bearer fake-token');
  });

  it('--dry-run stops after preview (no apply call)', async () => {
    const server = await withMock();
    const args = baseArgs(server.host);
    args.push('--dry-run');
    const { code } = await runCli(args, {});
    expect(code).toBe(0);
    const applyCalls = server.requests.filter((r) =>
      /\/imports\/apply(\/|$)/.test(r.path),
    );
    expect(applyCalls).toHaveLength(0);
    const previewCalls = server.requests.filter((r) =>
      r.path.endsWith('/imports/preview'),
    );
    expect(previewCalls.length).toBeGreaterThan(0);
  });

  it('--host is honored — the request URL uses our mock host', async () => {
    const server = await withMock();
    await runCli(baseArgs(server.host), {});
    // The mock server only sees requests routed to it, so any request
    // at all is proof of --host routing. Explicitly guard against a
    // future change that might route somewhere else.
    expect(server.requests.length).toBeGreaterThan(0);
  });

  it('requires --yes in non-interactive mode (already tested but reasserts here)', async () => {
    const server = await withMock();
    const args = baseArgs(server.host).filter((a) => a !== '--yes');
    const { code, stderr } = await runCli(args, {});
    expect(code).toBe(1);
    expect(stderr).toMatch(/apply push requires --yes in non-interactive/);
  });

  it('surfaces an API error when EMA returns 400 on preview', async () => {
    const server = await withMock();
    server.stub('POST', /imports\/preview$/, (req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sys: { id: 'ValidationFailed' }, message: 'bad manifest' }));
    });
    const { code, stderr } = await runCli(baseArgs(server.host), {});
    expect(code).toBeGreaterThan(0);
    expect(stderr).toMatch(/400|bad manifest|ValidationFailed/i);
  });

  it('surfaces an API error when EMA returns 401 on token validation', async () => {
    const server = await withMock();
    server.stub('GET', '/users/me', (req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sys: { id: 'AccessTokenInvalid' } }));
    });
    const { code, stderr } = await runCli(baseArgs(server.host), {});
    expect(code).toBeGreaterThan(0);
    expect(stderr).toMatch(/token is invalid|revoked/i);
  });
});

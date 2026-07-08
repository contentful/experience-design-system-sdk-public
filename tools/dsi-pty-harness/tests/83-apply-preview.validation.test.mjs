/**
 * Tier 5 — `experiences apply preview` (read-only diff against a mock EMA).
 *
 * The non-TTY branch (see apply/command.ts L495–498) writes a JSON summary
 * to stdout and exits 0. TTY-only Ink rendering is exercised by the push-
 * through-wizard tests. Here we go headless and assert on JSON shape.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from './helpers/run-cli.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { startMockEma } from './helpers/mock-ema.mjs';
import { REACT_MINIMAL_COMPONENTS_JSON } from './helpers/fixtures.mjs';

describe('apply preview', () => {
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
    'preview',
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
  ];

  it('renders a preview JSON summary against a mock EMA with a "new" component', async () => {
    const server = await withMock();
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

    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stdout, code } = await runCli(baseArgs(server.host), { env: t.env });
    expect(code).toBe(0);
    const summary = JSON.parse(stdout);
    // buildPreviewOutput reports counts per bucket, not component names.
    expect(summary.spaceId).toBe('sp1');
    expect(summary.environmentId).toBe('master');
    expect(summary.components).toEqual(
      expect.objectContaining({ new: 1, changed: 0, unchanged: 0, removed: 0 }),
    );

    // The mock must have received exactly one preview call (no apply).
    const previews = server.requests.filter((r) => r.path.endsWith('/imports/preview'));
    const applies = server.requests.filter((r) => r.path.endsWith('/imports/apply'));
    expect(previews.length).toBe(1);
    expect(applies.length).toBe(0);
  });

  it('propagates a preview 400 error and exits 1', async () => {
    const server = await withMock();
    server.stub('POST', /imports\/preview$/, (req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'invalid manifest' }));
    });

    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stderr, code } = await runCli(baseArgs(server.host), { env: t.env });
    expect(code).toBe(1);
    expect(stderr).toMatch(/invalid manifest|Error/);
  });

  it('forwards --cma-token as Authorization: Bearer <token>', async () => {
    const server = await withMock();
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { code } = await runCli(baseArgs(server.host), { env: t.env });
    expect(code).toBe(0);
    const previewReq = server.requests.find((r) =>
      r.path.endsWith('/imports/preview'),
    );
    expect(previewReq).toBeDefined();
    expect(previewReq.headers.authorization).toBe('Bearer fake-token');
  });
});

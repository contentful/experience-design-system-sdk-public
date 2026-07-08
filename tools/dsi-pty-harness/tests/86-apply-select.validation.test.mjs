/**
 * Tier 5 — `experiences apply select` (non-interactive branches).
 *
 * When any of --select-all / --select / --deselect is passed, apply select
 * skips the TUI, resolves the selection non-interactively, calls
 * applyImport, polls until succeeded, and prints a JSON summary. This
 * exercises every non-interactive flag against a mock EMA — the
 * interactive TUI branch is covered separately in the PTY suite (deferred
 * to Tier 5 follow-up).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCli } from './helpers/run-cli.mjs';
import { makeTmpHome } from './helpers/tmp-home.mjs';
import { startMockEma } from './helpers/mock-ema.mjs';
import { REACT_MINIMAL_COMPONENTS_JSON } from './helpers/fixtures.mjs';

describe('apply select — non-interactive', () => {
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
    'select',
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

  it('--select-all pushes every entity in the diff', async () => {
    const server = await withMock();
    server.stub('POST', /imports\/preview$/, (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          components: {
            new: [{ id: 'Button', name: 'Button' }, { id: 'Card', name: 'Card' }],
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
    const { stdout, code } = await runCli(
      [...baseArgs(server.host), '--select-all'],
      { env: t.env },
    );
    expect(code).toBe(0);
    const summary = JSON.parse(stdout);
    // buildApplyOutput reports at minimum the space + env context.
    expect(summary.spaceId).toBe('sp1');
    // Exactly one apply call landed on the mock.
    const applies = server.requests.filter((r) =>
      r.path.endsWith('/imports/apply'),
    );
    expect(applies.length).toBe(1);
  });

  it('--select <substring> narrows the push to matching components', async () => {
    const server = await withMock();
    server.stub('POST', /imports\/preview$/, (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          components: {
            new: [
              { id: 'Button', name: 'Button' },
              { id: 'Card', name: 'Card' },
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
    cleanups.push(t.cleanup);
    // Selection is substring-matched (key.includes(pattern), see
    // resolveNonInteractiveSelection in apply/command.ts) — not a glob.
    const { code } = await runCli(
      [...baseArgs(server.host), '--select', 'Button'],
      { env: t.env },
    );
    expect(code).toBe(0);
    // The applied manifest is the request body of /imports/apply. Card
    // must not appear (only Button matches "Bu*"); Button must appear.
    const applyReq = server.requests.find((r) =>
      r.path.endsWith('/imports/apply'),
    );
    expect(applyReq).toBeDefined();
    expect(applyReq.body).toMatch(/Button/);
    expect(applyReq.body).not.toMatch(/Card/);
  });

  it('breaking selection without --force exits 1', async () => {
    const server = await withMock();
    server.stub('POST', /imports\/preview$/, (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          components: {
            new: [],
            changed: [
              {
                current: { name: 'Button', $id: 'button-id' },
                proposed: { name: 'Button' },
                changeClassification: {
                  classification: 'breaking',
                  breakingChanges: [
                    { propertyId: 'label', reason: 'type changed' },
                  ],
                },
                impact: { affectedFragments: 1, affectedExperiences: 1 },
              },
            ],
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
    const { stderr, code } = await runCli(
      [...baseArgs(server.host), '--select-all'],
      { env: t.env },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/breaking changes.*Use --force/);
    const applies = server.requests.filter((r) =>
      r.path.endsWith('/imports/apply'),
    );
    expect(applies.length).toBe(0);
  });

  it('--select-all with no diff prints "up to date" and exits 0', async () => {
    const server = await withMock();
    // Default mock preview returns empty new/changed/etc.
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stderr, code } = await runCli(
      [...baseArgs(server.host), '--select-all'],
      { env: t.env },
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/up to date|Nothing to change/);
  });

  it('requires interactive terminal when no non-interactive flag is passed', async () => {
    const server = await withMock();
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stderr, code } = await runCli(baseArgs(server.host), { env: t.env });
    expect(code).toBe(1);
    expect(stderr).toMatch(/interactive terminal|--select-all/);
  });
});

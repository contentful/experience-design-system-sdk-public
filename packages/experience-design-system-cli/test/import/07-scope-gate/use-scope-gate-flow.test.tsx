import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { CacheCheckInput } from '../../../src/tui/import/steps/07-scope-gate/cache-check.js';
import {
  useScopeGateFlow,
  type ScopeGateFlow,
} from '../../../src/tui/import/steps/07-scope-gate/use-scope-gate-flow.js';
import type { ScopeComponent, ScopeGateLoad } from '../../../src/tui/import/steps/07-scope-gate/types.js';

const component = (name: string): ScopeComponent => ({
  name,
  componentId: name.toLowerCase(),
  aiDecision: null,
  aiReason: null,
  needsReview: false,
  slots: [],
});

const cache: CacheCheckInput = {
  sessionId: 'sess-1',
  tokensPath: '/p/tokens.json',
  agent: 'claude',
  promptOverrides: [],
  existingEntitiesPath: null,
  noCache: false,
};
const input = { sessionId: 'sess-1', cache };
const loadedOk: ScopeGateLoad = { ok: true, components: [component('Button'), component('Card')] };

// a promise the test settles by hand, to control when the cache check "finishes"
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

function mount(options: {
  input?: typeof input;
  load?: () => ScopeGateLoad;
  checkCache: (input: CacheCheckInput) => Promise<string[]>;
}) {
  const seen: { current?: ScopeGateFlow } = {};
  function Probe(): React.ReactElement {
    seen.current = useScopeGateFlow(options.input, {
      load: options.load ?? (() => loadedOk),
      checkCache: options.checkCache,
    });
    return <Text>{seen.current?.status ?? 'idle'}</Text>;
  }
  const app = render(<Probe />);
  return { seen, app };
}

const deciding = (flow: ScopeGateFlow | undefined) => {
  if (flow?.status !== 'deciding') throw new Error(`expected deciding, got ${flow?.status}`);
  return flow;
};

describe('useScopeGateFlow', () => {
  it('does nothing until there is a session', async () => {
    const checkCache = vi.fn();
    const { seen } = mount({ input: undefined, checkCache });
    await tick();
    expect(seen.current).toBeUndefined();
    expect(checkCache).not.toHaveBeenCalled();
  });

  it('shows the gate with the components it loaded', async () => {
    const { seen } = mount({ input, checkCache: () => Promise.resolve([]) });
    await tick();
    expect(deciding(seen.current).load.components.map((c) => c.name)).toEqual(['Button', 'Card']);
  });

  it('starts the cache check as soon as the gate opens, before anything is confirmed', async () => {
    const checkCache = vi.fn().mockReturnValue(new Promise(() => {}));
    const { seen } = mount({ input, checkCache });
    await tick();
    expect(seen.current?.status).toBe('deciding');
    expect(checkCache).toHaveBeenCalledTimes(1);
    expect(checkCache).toHaveBeenCalledWith(cache);
  });

  it('runs the check once however many times it renders', async () => {
    const checkCache = vi.fn().mockResolvedValue([]);
    const { app } = mount({ input, checkCache });
    await tick();
    app.rerender(<Text>again</Text>);
    await tick();
    expect(checkCache).toHaveBeenCalledTimes(1);
  });

  it('reports the scope with the cached names once the check has finished', async () => {
    const { seen } = mount({ input, checkCache: () => Promise.resolve(['Button']) });
    await tick();
    deciding(seen.current).confirm({ accepted: ['Button'], rejected: ['Card'] });
    await tick();
    expect(seen.current).toEqual({
      status: 'confirmed',
      scope: { accepted: ['Button'], rejected: ['Card'], cachedNames: ['Button'] },
    });
  });

  it('does not report the scope while the check is still running, so the wizard cannot start before the cache is restored', async () => {
    const check = deferred<string[]>();
    const { seen } = mount({ input, checkCache: () => check.promise });
    await tick();
    deciding(seen.current).confirm({ accepted: ['Button'], rejected: [] });
    await tick();
    expect(seen.current?.status).toBe('preparing');

    check.resolve(['Button']);
    await tick();
    expect(seen.current).toEqual({
      status: 'confirmed',
      scope: { accepted: ['Button'], rejected: [], cachedNames: ['Button'] },
    });
  });

  it('only reports cached names that were accepted, since the wizard only looks at those and the handoff has a size limit', async () => {
    const { seen } = mount({ input, checkCache: () => Promise.resolve(['Button', 'Card', 'Helper']) });
    await tick();
    deciding(seen.current).confirm({ accepted: ['Button', 'Card'], rejected: ['Helper'] });
    await tick();
    expect(seen.current).toEqual({
      status: 'confirmed',
      scope: { accepted: ['Button', 'Card'], rejected: ['Helper'], cachedNames: ['Button', 'Card'] },
    });
  });

  it('reports an empty cache when the check found nothing', async () => {
    const { seen } = mount({ input, checkCache: () => Promise.resolve([]) });
    await tick();
    deciding(seen.current).confirm({ accepted: ['Card'], rejected: ['Button'] });
    await tick();
    expect(seen.current).toMatchObject({ status: 'confirmed', scope: { cachedNames: [] } });
  });

  it('reports the error and never starts the check when the components could not be loaded', async () => {
    const checkCache = vi.fn();
    const { seen } = mount({
      input,
      load: () => ({ ok: false, message: 'No components found for this session.' }),
      checkCache,
    });
    await tick();
    expect(seen.current).toEqual({ status: 'failed', message: 'No components found for this session.' });
    expect(checkCache).not.toHaveBeenCalled();
  });
});

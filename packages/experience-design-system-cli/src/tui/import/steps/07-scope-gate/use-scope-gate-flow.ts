import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScopeHandoff } from '@contentful/experience-design-system-types/handoff';
import { checkGenerationCache, type CacheCheckInput } from './cache-check.js';
import { loadScopeGate } from './load.js';
import type { ScopeDecisions, ScopeGateLoad } from './types.js';

// The lifecycle around the gate screen, kept out of the screen so it can be tested without a terminal:
//  1. the components are read once, before the screen shows
//  2. the generation cache check starts straight away and runs while the user decides
//  3. on confirm, the flow waits for that check to settle, then reports the scope for the wizard
//
// The wait in step 3 is the order the wizard relied on: `--restore-cache` writes to the same database as the decisions,
// so the cache is restored first and the decisions saved second. The wizard saves them, so the flow only has to make
// sure the restore is finished before it starts the wizard.

export type ScopeGateFlow =
  | { status: 'failed'; message: string }
  | { status: 'deciding'; load: Extract<ScopeGateLoad, { ok: true }>; confirm: (decisions: ScopeDecisions) => void }
  /** Confirmed before the cache check finished. */
  | { status: 'preparing' }
  | { status: 'confirmed'; scope: ScopeHandoff };

interface Deps {
  load: typeof loadScopeGate;
  checkCache: (input: CacheCheckInput) => Promise<string[]>;
}

const realDeps: Deps = { load: loadScopeGate, checkCache: checkGenerationCache };

/** `input` is undefined until the extraction stage has produced a session, so the hook can be called unconditionally. */
export function useScopeGateFlow(
  input: { sessionId: string; cache: CacheCheckInput } | undefined,
  deps: Deps = realDeps,
): ScopeGateFlow | undefined {
  const sessionId = input?.sessionId;
  const loaded = useMemo(() => (sessionId ? deps.load(sessionId) : undefined), [sessionId]);
  const cacheCheck = useRef<Promise<string[]> | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<ScopeDecisions>();
  const [scope, setScope] = useState<ScopeHandoff>();

  // Started once per session, as soon as the gate has components to show.
  useEffect(() => {
    if (!input || !loaded?.ok || cacheCheck.current) return;
    cacheCheck.current = deps.checkCache(input.cache);
  }, [input, loaded]);

  // After a confirm, wait for the check, then report the scope.
  useEffect(() => {
    if (!confirmed || !cacheCheck.current) return;
    let current = true;
    void cacheCheck.current.then((cachedNames) => {
      // The wizard only compares the components that were accepted, and the handoff travels in one environment
      // variable, so leave out the cached components that were not.
      const accepted = new Set(confirmed.accepted);
      if (current) setScope({ ...confirmed, cachedNames: cachedNames.filter((name) => accepted.has(name)) });
    });
    return () => {
      current = false;
    };
  }, [confirmed]);

  if (!input || !loaded) return undefined;
  if (!loaded.ok) return { status: 'failed', message: loaded.message };
  if (scope) return { status: 'confirmed', scope };
  if (confirmed) return { status: 'preparing' };
  return { status: 'deciding', load: loaded, confirm: setConfirmed };
}

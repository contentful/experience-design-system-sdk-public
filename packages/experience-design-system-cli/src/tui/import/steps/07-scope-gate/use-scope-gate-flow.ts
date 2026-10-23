import { useEffect, useMemo, useRef, useState } from 'react';
import { checkGenerationCache, type CacheCheckInput } from './cache-check.js';
import { loadScopeGate } from './load.js';
import type { ScopeDecisions, ScopeGateLoad } from './types.js';

// The lifecycle around the gate screen, kept out of the screen so it can be tested without a terminal:
//  1. the components are read once, before the screen shows
//  2. the generation cache check starts straight away and runs while the user decides
//  3. on confirm, the decisions are handed on together with that check, so generation can wait for it
//
// Generation has to wait: `--restore-cache` writes to the same database as the decisions, and the wizard always restored
// the cache first and saved the decisions second. The check is handed over as a promise so that wait stays inside
// generation, where the decisions are saved.

export type ScopeGateFlow =
  | { status: 'failed'; message: string }
  | { status: 'deciding'; load: Extract<ScopeGateLoad, { ok: true }>; confirm: (decisions: ScopeDecisions) => void }
  | { status: 'confirmed'; decisions: ScopeDecisions; cachedNames: Promise<string[]> };

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

  // Started once per session, as soon as the gate has components to show.
  useEffect(() => {
    if (!input || !loaded?.ok || cacheCheck.current) return;
    cacheCheck.current = deps.checkCache(input.cache);
  }, [input, loaded]);

  if (!input || !loaded) return undefined;
  if (!loaded.ok) return { status: 'failed', message: loaded.message };
  if (confirmed && cacheCheck.current)
    return { status: 'confirmed', decisions: confirmed, cachedNames: cacheCheck.current };
  return { status: 'deciding', load: loaded, confirm: setConfirmed };
}

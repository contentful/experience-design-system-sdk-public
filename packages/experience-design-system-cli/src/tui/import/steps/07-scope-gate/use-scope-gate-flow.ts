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
  input: { attemptId: number; signal: AbortSignal; sessionId: string; cache: CacheCheckInput } | undefined,
  deps: Deps = realDeps,
): ScopeGateFlow | undefined {
  const sessionId = input?.sessionId;
  const loaded = useMemo(() => (sessionId ? deps.load(sessionId) : undefined), [sessionId]);
  const cacheCheck = useRef<{ attemptId: number; promise: Promise<string[]> }>();
  const [confirmed, setConfirmed] = useState<{ attemptId: number; decisions: ScopeDecisions }>();

  // Started once per attempt, as soon as the gate has components to show.
  useEffect(() => {
    if (!input || input.signal.aborted || !loaded?.ok || cacheCheck.current?.attemptId === input.attemptId) return;
    const promise = Promise.resolve().then(() => (input.signal.aborted ? [] : deps.checkCache(input.cache)));
    void promise.catch(() => {});
    cacheCheck.current = { attemptId: input.attemptId, promise };
  }, [input, loaded]);

  if (!input || input.signal.aborted || !loaded) return undefined;
  if (!loaded.ok) return { status: 'failed', message: loaded.message };
  const currentCacheCheck = cacheCheck.current?.attemptId === input.attemptId ? cacheCheck.current.promise : undefined;
  const currentConfirmation = confirmed?.attemptId === input.attemptId ? confirmed.decisions : undefined;
  if (currentConfirmation && currentCacheCheck)
    return { status: 'confirmed', decisions: currentConfirmation, cachedNames: currentCacheCheck };
  return {
    status: 'deciding',
    load: loaded,
    confirm: (decisions) => {
      if (!input.signal.aborted) setConfirmed({ attemptId: input.attemptId, decisions });
    },
  };
}

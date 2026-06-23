import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { ApiError } from '../../apply/api-client.js';
import { runLivePreview } from './runLivePreview.js';

export type UseLivePreviewOptions = {
  enabled: boolean;
  sessionId: string;
  tokensPath: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
  onResult: (response: ServerPreviewResponse | null) => void;
  debounceMs?: number;
};

export type LivePreviewStatus = 'idle' | 'running';

export type UseLivePreviewReturn = {
  trigger: () => void;
  status: LivePreviewStatus;
  disabled: boolean;
};

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Hook that owns the post-save live-preview side effect for the wizard's
 * final-review step. Centralizes:
 *
 * - 500ms debounce so rapid Ctrl+S spam collapses to a single API call.
 * - Generation tag on every fire so a stale in-flight call's response is
 *   discarded if a newer fire has already kicked off (in lieu of an
 *   AbortController for v1).
 * - Disable-for-session on 401/403: subsequent triggers no-op until the
 *   wizard exits. One-line stderr warning. No modal, no re-prompt — the
 *   operator is mid-edit and we must not interrupt the flow.
 * - Status state for the sidebar spinner (`'idle' | 'running'`).
 *
 * Cred-missing / disabled / not-enabled cases short-circuit BEFORE the timer
 * is set so we don't accumulate dead timers.
 */
export function useLivePreview(opts: UseLivePreviewOptions): UseLivePreviewReturn {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const [status, setStatus] = useState<LivePreviewStatus>('idle');
  const [disabled, setDisabled] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const latestRef = useRef(0);
  const inflightRef = useRef(0);

  // Mirror props in a ref so the trigger callback can stay stable.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  // Mirror disabled into a ref so the timer callback sees the latest value
  // without redefining `trigger` (which would defeat its memoization).
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  // Clear any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const trigger = useCallback(() => {
    const current = optsRef.current;
    if (!current.enabled) return;
    if (disabledRef.current) return;
    if (!current.spaceId || !current.environmentId || !current.cmaToken) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void fire();
    }, debounceMs);
  }, [debounceMs]);

  const fire = async (): Promise<void> => {
    const current = optsRef.current;
    if (disabledRef.current) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    latestRef.current = generation;
    inflightRef.current += 1;
    setStatus('running');
    try {
      const result = await runLivePreview({
        sessionId: current.sessionId,
        tokensPath: current.tokensPath,
        spaceId: current.spaceId,
        environmentId: current.environmentId,
        cmaToken: current.cmaToken,
        host: current.host,
        generation,
      });
      // Discard stale responses (generation tag).
      if (result.generation !== latestRef.current) return;
      current.onResult(result.response);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setDisabled(true);
        disabledRef.current = true;
        try {
          process.stderr.write(`live-preview: ${err.status}, disabling for this session\n`);
        } catch {
          // best-effort
        }
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          process.stderr.write(`live-preview: ${msg}\n`);
        } catch {
          // best-effort
        }
      }
    } finally {
      inflightRef.current -= 1;
      if (inflightRef.current <= 0) {
        inflightRef.current = 0;
        setStatus('idle');
      }
    }
  };

  return { trigger, status, disabled };
}

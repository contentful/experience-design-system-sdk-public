import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { buildManifest } from '@contentful/experience-design-system-types';
import { ImportApiClient } from '../../apply/api-client.js';
import { readTokensFromPath } from '../../apply/manifest.js';
import { backfillUnclassifiedProps, loadCDFComponents, openPipelineDb } from '../../session/db.js';

export class TimeoutError extends Error {
  constructor(message = 'live-preview timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export type LivePreviewResult = {
  generation: number;
  response: ServerPreviewResponse | null;
};

export type RunLivePreviewOptions = {
  sessionId: string;
  tokensPath: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
  generation: number;
  timeoutMs?: number;
  /** When true and no components are accepted, preview an empty-but-present
   *  components manifest so the server returns the full delete-all diff
   *  (every existing component as `removed`) instead of rejecting an empty
   *  manifest. Lets the final-review UI show what a push would delete. */
  deleteAllComponents?: boolean;
  /** Restrict the preview to these component keys (the operator's accepted
   *  set). Undefined = all generated components in the session. An empty set
   *  narrows to zero components — pair with `deleteAllComponents` to preview a
   *  full delete. Lets the Finalize dialog show exactly what the accepted push
   *  would delete, independent of the session's on-disk generated rows. */
  acceptedKeys?: ReadonlySet<string>;
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Pure async helper used by `useLivePreview` to re-fire `previewImport` after a
 * FieldEditor save in the wizard's final-review step. Mirrors the round-1
 * `runScopeGate` shape: a side-effect-bearing pure orchestrator that owns no
 * React state.
 *
 * Skips silently (returns `{ response: null }`) when any of `spaceId`,
 * `environmentId`, or `cmaToken` is missing — live preview is an enhancement
 * and the caller treats `null` as a no-op. Throws on API errors so the caller
 * (`useLivePreview`) can downgrade to local-only mode on 401/403 and log a
 * warning otherwise. Wraps the API call in a timeout so a hung backend doesn't
 * leave the spinner stuck.
 *
 * Does NOT run the second-pass seeding from `WizardApp.runPreview`; that's a
 * one-shot wizard-step concern and would re-seed on every save.
 */
export async function runLivePreview(opts: RunLivePreviewOptions): Promise<LivePreviewResult> {
  const { sessionId, tokensPath, spaceId, environmentId, cmaToken, host, generation } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!spaceId || !environmentId || !cmaToken) {
    return { generation, response: null };
  }

  let components: Array<{
    key: string;
    entry: import('@contentful/experience-design-system-types').CDFComponentEntry;
  }> = [];
  if (sessionId) {
    const db = openPipelineDb();
    try {
      backfillUnclassifiedProps(db, sessionId);
      components = loadCDFComponents(db, sessionId);
    } finally {
      db.close();
    }
  }

  // Narrow to the accepted set when provided, so the preview reflects exactly
  // what a push of those components would create/update/remove — the session's
  // generated rows still include not-yet-reclassified rejects at this point.
  if (opts.acceptedKeys) {
    components = components.filter((c) => opts.acceptedKeys!.has(c.key));
  }

  let tokens: import('@contentful/experience-design-system-types').DTCGTokenEntry[] = [];
  if (tokensPath) {
    tokens = await readTokensFromPath('tokens', tokensPath);
  }

  const manifest = buildManifest(components, tokens, { deleteAllComponents: opts.deleteAllComponents === true });

  const client = new ImportApiClient({ host, cmaToken, spaceId, environmentId });
  const startedAt = Date.now();

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(new TimeoutError()), timeoutMs);
  });

  try {
    const response = (await Promise.race([client.previewImport(manifest), timeoutPromise])) as ServerPreviewResponse;
    if (process.env['EDS_VERBOSE']) {
      const durationMs = Date.now() - startedAt;
      try {
        process.stderr.write(`live-preview: ${durationMs}ms\n`);
      } catch {
        // best-effort
      }
    }
    return { generation, response };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

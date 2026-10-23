import type { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  appendRun,
  buildSourceFingerprint,
  loadCDFComponents,
  loadDTCGTokens,
  openPipelineDb,
  readTokensFromPath,
  toCDFTokens,
} from '@contentful/experience-design-system-backend-pipeline';
import {
  buildCDF,
  validateCDF,
  type CDFComponentEntry,
  type CDFDocument,
  type DTCGTokenEntry,
} from '@contentful/experience-design-system-types';
import { nextStateAfterPrint } from '../support/run-print-files-helpers.js';
import type { FlowPatch, FlowState } from './types.js';

/** How long the confirmation of a written file stays up before the flow moves on to the preview. */
const SAVE_CONFIRMATION_DELAY_MS = 1000;

/** The document written to `components.json`: the components and tokens as one schema-valid CDF. */
function buildSavedCDF(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
  tokens: DTCGTokenEntry[],
  opts: { deleteAll?: boolean } = {},
): CDFDocument {
  const cdf = buildCDF(components, toCDFTokens(tokens), opts);
  if (!cdf) throw new Error('nothing to save — no components or tokens resolved');
  const validation = validateCDF(cdf);
  if (!validation.valid) {
    throw new Error(`generated CDF failed validation: ${validation.errors.map((error) => error.message).join(', ')}`);
  }
  return cdf;
}

/** The outside world saving talks to, so each branch can be tested without a disk, a database or a clock. */
export interface SaveDeps {
  openDb: () => DatabaseSync;
  readTokens: (path: string) => Promise<DTCGTokenEntry[]>;
  writeFile: (path: string, contents: string) => Promise<void>;
  appendRun: typeof appendRun;
  buildSourceFingerprint: typeof buildSourceFingerprint;
  sleep: (ms: number) => Promise<void>;
  warn: (message: string) => void;
}

export const realSaveDeps = (): SaveDeps => ({
  openDb: openPipelineDb,
  readTokens: (path) => readTokensFromPath({ flag: 'tokens', path }),
  writeFile: (path, contents) => writeFile(path, contents),
  appendRun,
  buildSourceFingerprint,
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  warn: (message) => process.stderr.write(message),
});

export interface WriteFilesInput {
  extractSessionId: string | null;
  outDir: string;
  tokenSessionId?: string | null;
  tokensPath?: string;
  skipGate?: boolean;
  allowEmpty?: boolean;
}

/**
 * Writes `components.json` to `outDir`. Returns the patch for the step after (the print gate, or nothing when the save
 * is part of a push and goes straight on), or an error patch when the document could not be built or written.
 * `onPatch` receives the "printing" step while it works.
 */
export async function runPrintFiles(
  input: WriteFilesInput,
  deps: SaveDeps,
  onPatch: (patch: FlowPatch) => void,
): Promise<{ ok: true; patch: FlowPatch } | { ok: false; patch: FlowPatch }> {
  onPatch({ step: 'printing' });
  const componentsPath = join(input.outDir, 'components.json');
  try {
    const db = deps.openDb();
    let components: ReturnType<typeof loadCDFComponents> = [];
    let tokens: DTCGTokenEntry[] = [];
    try {
      if (input.extractSessionId) components = loadCDFComponents(db, input.extractSessionId);
      if (input.tokenSessionId) tokens = loadDTCGTokens(db, input.tokenSessionId).tokens;
    } finally {
      db.close();
    }
    if (!input.tokenSessionId && input.tokensPath) tokens = await deps.readTokens(input.tokensPath);

    const cdf = buildSavedCDF(components, tokens, { deleteAll: input.allowEmpty });
    await deps.writeFile(componentsPath, `${JSON.stringify(cdf, null, 2)}\n`);
    deps.warn(
      `wrote ${componentsPath} (${components.length} component${components.length === 1 ? '' : 's'}, ${tokens.length} token${tokens.length === 1 ? '' : 's'})\n`,
    );
  } catch (error) {
    return {
      ok: false,
      patch: {
        step: 'error',
        errorStep: 'save CDF',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
  // Keep the successful write confirmation visible long enough to read before the save-and-push flow advances.
  await deps.sleep(SAVE_CONFIRMATION_DELAY_MS);
  return { ok: true, patch: nextStateAfterPrint({ skipGate: input.skipGate, componentsPath }) as FlowPatch };
}

export interface RecordRunInput {
  state: Pick<
    FlowState,
    | 'extractSessionId'
    | 'rawTokensPath'
    | 'projectPath'
    | 'generatedAcceptedCount'
    | 'generatedCount'
    | 'tokenCount'
    | 'tokenSessionId'
    | 'tokensPath'
    | 'agent'
    | 'generateSessionId'
  >;
  savePath: string;
}

/** Records the run, so it can be found and pushed later. A run that cannot be recorded is warned about, never fatal. */
export async function recordRun(input: RecordRunInput, deps: SaveDeps): Promise<string | null> {
  const { state } = input;
  try {
    let sourceFingerprint: Awaited<ReturnType<typeof buildSourceFingerprint>> | null = null;
    try {
      if (state.extractSessionId) {
        const db = deps.openDb();
        try {
          sourceFingerprint = await deps.buildSourceFingerprint({
            db,
            extractSessionId: state.extractSessionId,
            rawTokensPath: state.rawTokensPath || null,
          });
        } finally {
          db.close();
        }
      }
    } catch (err) {
      deps.warn(`Warning: failed to compute source fingerprint: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    const record = await deps.appendRun({
      projectPath: state.projectPath,
      savePath: input.savePath,
      componentCount: state.generatedAcceptedCount || state.generatedCount,
      tokenCount: state.tokenCount,
      tokensPath: (state.tokenSessionId ? state.tokensPath || null : null) || null,
      tokenSessionId: state.tokenSessionId,
      agent: state.agent,
      pushedTo: null,
      extractSessionId: state.extractSessionId ?? '',
      generateSessionId: state.generateSessionId,
      sourceFingerprint,
    });
    return record.id;
  } catch (err) {
    deps.warn(`Warning: failed to record run: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

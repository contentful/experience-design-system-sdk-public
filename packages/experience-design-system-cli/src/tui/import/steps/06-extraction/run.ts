import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  checkAgentAuth,
  fetchAndPersistExistingContentfulEntities,
  parsePromptOverrides,
  resolvePromptOverride,
  runExtractAndComposeSession,
  type AgentName,
} from '@contentful/experience-design-system-backend-pipeline';
import { agentAuthMessage, applyProgressEvent, initialProgress, noComponentsMessage } from './logic.js';
import { runTokenGeneration, type TokenGenerationResult } from './processes.js';
import { runSelection } from './selection.js';
import type { ExtractionHandoff } from '@contentful/experience-design-system-types/handoff';
import type { ExtractionInput, ExtractionProgress, ExtractionResult } from './types.js';

type Failure = Extract<ExtractionResult, { ok: false }>;

/** The outside world the stage talks to, so the order of events can be tested without a network, an agent or a CLI. */
export interface ExtractionDeps {
  checkAgentAuth: typeof checkAgentAuth;
  fetchEntities: (credentials: NonNullable<ExtractionInput['credentials']>, outDir: string) => Promise<string | null>;
  runExtractAndComposeSession: typeof runExtractAndComposeSession;
  runTokenGeneration: typeof runTokenGeneration;
  runSelection: typeof runSelection;
}

const realDeps: ExtractionDeps = {
  checkAgentAuth,
  fetchEntities,
  runExtractAndComposeSession,
  runTokenGeneration,
  runSelection,
};

const fail = (step: Failure['step'], message: string): Failure => ({ ok: false, step, message });
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Runs the stage. The jobs overlap exactly as they did when extract was a
 * subprocess:
 *
 *   entities fetch ───────────────────┐
 *   extract + compose (in-process)    │
 *     └─ onSessionCreated(id) ────────┴─ selection agent (waits for fetch) ──┐
 *     └──────────────────────── returns (composition done) ─────────────────┴─ result
 *   token generation            (only when the tokens are not being reused)
 *
 * Selection starts the moment the orchestrator mints the sessionId, so it
 * overlaps with composition. When more than one job fails, the error reported
 * is the first of: extract, no components, selection, token generation.
 */
export async function runExtraction(
  input: ExtractionInput,
  onProgress: (progress: ExtractionProgress) => void,
  deps: ExtractionDeps = realDeps,
): Promise<ExtractionResult> {
  const outDir = join(resolve(input.projectPath), '.contentful');
  let progress = initialProgress({
    hasCredentials: input.credentials !== null,
    hasRawTokens: input.rawTokensPath !== '',
    reuseTokens: input.tokenStrategy === 'reuse',
  });
  const update = (change: Partial<ExtractionProgress>): void => {
    progress = { ...progress, ...change };
    onProgress(progress);
  };
  onProgress(progress);

  const auth = await deps.checkAgentAuth(input.agent as AgentName);
  if (auth === 'not-found' || auth === 'unauthenticated') {
    return fail(`${input.agent} auth check`, agentAuthMessage(input.agent, auth));
  }

  let selectionPrompt: { promptText?: string; promptPath?: string };
  try {
    selectionPrompt = await resolveSelectionPrompt(input.promptOverrides);
  } catch (error) {
    return fail('selection agent', errorMessage(error));
  }

  // Token generation runs at the same time as everything else.
  const tokenGeneration: Promise<TokenGenerationResult | null> =
    input.rawTokensPath !== '' && input.tokenStrategy !== 'reuse'
      ? deps
          .runTokenGeneration({
            rawTokensPath: input.rawTokensPath,
            outDir,
            agent: input.agent,
            agentModel: input.agentModel,
            promptOverrides: input.promptOverrides,
            // the regenerate answer forces the cache off for this run only
            noCache: input.noCache || input.tokenStrategy === 'regenerate',
          })
          .then((result) => {
            update({ tokens: result.ok ? 'complete' : 'failed' });
            return result;
          })
      : Promise.resolve(null);

  // The entities fetch starts before extraction, and selection waits for it.
  let existingEntitiesPath: string | null = null;
  const entities: Promise<boolean> | null = input.credentials
    ? deps.fetchEntities(input.credentials, outDir).then((path) => {
        existingEntitiesPath = path;
        update({ existingEntities: path ? 'complete' : 'failed' });
        return path !== null;
      })
    : null;

  let selection: Promise<void> | null = null;
  let selectionError: unknown;
  const startSelection = (sessionId: string): void => {
    if (selection) return;
    selection = (async () => {
      if (entities) await entities;
      await deps.runSelection({
        sessionId,
        agent: input.agent as AgentName,
        model: input.agentModel,
        ...selectionPrompt,
        noCache: input.noCache,
      });
    })()
      .catch((error: unknown) => {
        selectionError = error;
      })
      .finally(() => update({ selection: 'complete' }));
  };

  let extracted: Awaited<ReturnType<typeof runExtractAndComposeSession>>;
  try {
    extracted = await deps.runExtractAndComposeSession({
      projectPath: input.projectPath,
      outDir,
      filePaths: input.filePaths,
      agent: input.agent,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: input.promptOverrides,
      noCache: input.noCache,
      onProgress: (event) => update(applyProgressEvent(progress, event)),
      onSessionCreated: (sessionId) => startSelection(sessionId),
    });
  } catch (error) {
    return fail('analyze extract', errorMessage(error));
  }

  if (selection) await selection;
  if (!selection && entities) await entities;

  if (extracted.components.length === 0) return fail('analyze extract', noComponentsMessage(input.projectPath));
  if (selectionError) return fail('selection agent', errorMessage(selectionError));

  const tokens = await tokenGeneration;
  if (tokens && !tokens.ok) return fail(tokens.step, tokens.message);

  // A reused catalog is already on disk. With no token source there is no file, and the later steps read an empty path as
  // "no tokens" (generating with --tokens pointing at a missing file fails).
  const hasTokenSource = input.rawTokensPath !== '' || input.tokenStrategy === 'reuse';


  const extraction: ExtractionHandoff = {
    sessionId: extracted.sessionId,
    outDir,
    tokensPath: tokens?.ok ? tokens.tokensPath : hasTokenSource ? join(outDir, 'tokens.json') : '',
    tokenSessionId: tokens?.ok ? tokens.tokenSessionId : null,
    tokenCount: tokens?.ok ? tokens.tokenCount : 0,
    existingEntitiesPath,
    existingEntitiesStatus:
      progress.existingEntities === 'complete' || progress.existingEntities === 'failed'
        ? progress.existingEntities
        : 'idle',
    compositionPhase: extracted.compositionPhase,
  };
  return { ok: true, extraction };
}

async function fetchEntities(
  credentials: NonNullable<ExtractionInput['credentials']>,
  outDir: string,
): Promise<string | null> {
  try {
    await mkdir(outDir, { recursive: true });
    const result = await fetchAndPersistExistingContentfulEntities({
      spaceId: credentials.spaceId,
      environmentId: credentials.environmentId,
      cmaToken: credentials.cmaToken,
      ...(credentials.host ? { host: credentials.host } : {}),
      outDir,
    });
    return result.ok ? result.path : null;
  } catch {
    return null;
  }
}

/** The `--prompt select=…` override, as text or as a path, exactly as the wizard resolved it. */
async function resolveSelectionPrompt(overrides: string[]): Promise<{ promptText?: string; promptPath?: string }> {
  const { overrides: parsed, errors } = parsePromptOverrides(overrides);
  if (errors.length > 0) throw new Error(errors.join('; '));
  const select = parsed.get('select');
  if (select?.kind === 'text') return { promptText: select.value };
  if (select?.kind === 'path') {
    await resolvePromptOverride(select);
    return { promptPath: resolve(select.value) };
  }
  return {};
}

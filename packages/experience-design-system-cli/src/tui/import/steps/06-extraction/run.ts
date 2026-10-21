import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  checkAgentAuth,
  openPipelineDb,
  bindCatalogueCaptureToSession,
  type ExistingContentfulEntities,
  fetchAndPersistExistingContentfulEntities,
  parsePromptOverrides,
  resolvePromptOverride,
  runExtractAndComposeSession,
  runGenerateTokensSession,
  type AgentName,
} from '@contentful/experience-design-system-backend-pipeline';
import { findSkillPath } from './find-skill-path.js';
import { agentAuthMessage, applyProgressEvent, initialProgress, noComponentsMessage } from './logic.js';
import { runSelection } from './selection.js';
import type { ExtractionHandoff } from '@contentful/experience-design-system-types/handoff';
import type { ExtractionInput, ExtractionProgress, ExtractionResult } from './types.js';
import { awaitWithSignal, linkAbortSignal, throwIfAborted } from '../../cancellation.js';

const TOKENS_SKILL_PATH = findSkillPath('generate-tokens.md');

type Failure = Extract<ExtractionResult, { ok: false }>;

type TokenGenerationResult =
  | { ok: true; tokensPath: string; tokenSessionId: string | null; tokenCount: number }
  | { ok: false; step: 'generate tokens'; message: string };

/** The outside world the stage talks to, so the order of events can be tested without a network, an agent or a CLI. */
export interface ExtractionDeps {
  checkAgentAuth: typeof checkAgentAuth;
  fetchEntities: (
    credentials: NonNullable<ExtractionInput['credentials']>,
    outDir: string,
    onCapture?: (entities: ExistingContentfulEntities) => void,
  ) => Promise<string | null>;
  runExtractAndComposeSession: typeof runExtractAndComposeSession;
  runGenerateTokensSession: typeof runGenerateTokensSession;
  runSelection: typeof runSelection;
}

const realDeps: ExtractionDeps = {
  checkAgentAuth,
  fetchEntities,
  runExtractAndComposeSession,
  runGenerateTokensSession,
  runSelection,
};

const fail = (step: Failure['step'], message: string): Failure => ({ ok: false, step, message });
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Runs the stage. The jobs overlap exactly as they did when extract was a
 * subprocess:
 *
 *   entities fetch ───────────────────┐
 *   extract + compose (in-process) ── returns complete source evidence ──┐
 *   token generation            (only when the tokens are not being reused)│
 *   entities fetch ──────────────────────────────────────────────────────┤
 *   selection (after extraction returns; waits for entities) ────────────┴─ result
 *
 * Selection consumes the completed saved source envelope, so it starts only
 * after extraction and composition return. When multiple jobs fail, the
 * reported error priority is: extract, no components, selection, token generation.
 */
export async function runExtraction(
  input: ExtractionInput,
  onProgress: (progress: ExtractionProgress) => void,
  deps: ExtractionDeps = realDeps,
): Promise<ExtractionResult> {
  const linked = linkAbortSignal(input.signal);
  const { controller } = linked;
  const signal = controller.signal;
  const outDir = input.outDir ?? join(resolve(input.projectPath), '.contentful');
  let progress = initialProgress({
    hasCredentials: input.credentials !== null,
    hasRawTokens: input.rawTokensPath !== '',
    reuseTokens: input.tokenStrategy === 'reuse',
  });
  const update = (change: Partial<ExtractionProgress>): void => {
    if (signal.aborted) return;
    progress = { ...progress, ...change };
    onProgress(progress);
  };
  let selection: Promise<void> | undefined;
  let selectionError: unknown;
  let createdSessionId: string | undefined;
  let entities: Promise<boolean> | null = null;
  let tokenGeneration: Promise<TokenGenerationResult | null> = Promise.resolve(null);

  const drainSiblings = async (): Promise<void> => {
    await Promise.allSettled([tokenGeneration, ...(selection ? [selection] : []), ...(entities ? [entities] : [])]);
  };
  const cancelAndDrain = async (): Promise<void> => {
    controller.abort();
    await drainSiblings();
  };

  try {
    throwIfAborted(signal);
    onProgress(progress);

    const auth = await awaitWithSignal(deps.checkAgentAuth(input.agent as AgentName), signal);
    throwIfAborted(signal);
    if (auth === 'not-found' || auth === 'unauthenticated') {
      return fail(`${input.agent} auth check`, agentAuthMessage(input.agent, auth));
    }

    const selectionPrompt = await awaitWithSignal(resolveSelectionPrompt(input.promptOverrides), signal);
    throwIfAborted(signal);

    // Token generation runs at the same time as extraction and selection.
    tokenGeneration =
      input.rawTokensPath !== '' && input.tokenStrategy !== 'reuse'
        ? deps
            .runGenerateTokensSession({
              rawTokensPath: input.rawTokensPath,
              outDir,
              agent: input.agent as AgentName,
              ...(input.agentModel ? { agentModel: input.agentModel } : {}),
              promptOverrides: input.promptOverrides,
              skillPath: TOKENS_SKILL_PATH,
              noCache: input.noCache || input.tokenStrategy === 'regenerate',
              signal,
            })
            .then((result): TokenGenerationResult => {
              update({ tokens: 'complete' });
              return {
                ok: true,
                tokensPath: result.tokensPath,
                tokenSessionId: result.tokenSessionId,
                tokenCount: result.tokenCount,
              };
            })
            .catch((error: unknown): TokenGenerationResult => {
              update({ tokens: 'failed' });
              return {
                ok: false,
                step: 'generate tokens',
                message: errorMessage(error),
              };
            })
        : Promise.resolve(null);

    let existingEntitiesPath: string | null = null;
    let capturedEntities: ExistingContentfulEntities | undefined;
    entities = input.credentials
      ? deps
          .fetchEntities(input.credentials, outDir, (capture) => {
            capturedEntities = capture;
          })
          .then((path) => {
            existingEntitiesPath = path;
            update({ existingEntities: path ? 'complete' : 'failed' });
            return path !== null;
          })
          .catch(() => {
            update({ existingEntities: 'failed' });
            return false;
          })
      : null;

    const startSelection = (
      sessionId: string,
      sourceEvidenceHandle: Awaited<ReturnType<typeof runExtractAndComposeSession>>['sourceEvidenceHandle'],
    ): void => {
      if (selection || signal.aborted) return;
      selection = (async () => {
        if (entities) await awaitWithSignal(entities, signal);
        throwIfAborted(signal);
        await deps.runSelection({
          promptOverrides: input.promptOverrides,
          sessionId,
          sourceEvidenceHandle,
          existingEntitiesPath,
          agent: input.agent as AgentName,
          model: input.agentModel,
          ...selectionPrompt,
          noCache: true,
          signal,
        });
        throwIfAborted(signal);
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
        sourceInventory: input.sourceInventory,
        evidenceFilePaths: input.evidenceFilePaths,
        agent: input.agent,
        ...(input.agentModel ? { agentModel: input.agentModel } : {}),
        promptOverrides: input.promptOverrides,
        noCache: true,
        signal,
        onProgress: (event) => update(applyProgressEvent(progress, event)),
        onSessionCreated: (sessionId) => {
          createdSessionId = sessionId;
        },
      });
    } catch (error) {
      await cancelAndDrain();
      return fail('analyze extract', errorMessage(error));
    }
    throwIfAborted(signal);

    if (createdSessionId !== undefined && createdSessionId !== extracted.sessionId) {
      await cancelAndDrain();
      return fail('analyze extract', 'extraction returned a different session than the session-created notification');
    }

    if (extracted.components.length === 0) {
      await cancelAndDrain();
      return fail('analyze extract', noComponentsMessage(input.projectPath));
    }

    startSelection(extracted.sessionId, extracted.sourceEvidenceHandle);

    if (selection) await selection;
    else if (entities) await awaitWithSignal(entities, signal);
    if (selectionError) {
      await cancelAndDrain();
      return fail('selection agent', errorMessage(selectionError));
    }

    const tokens = await tokenGeneration;
    throwIfAborted(signal);
    if (tokens && !tokens.ok) {
      await cancelAndDrain();
      return fail(tokens.step, tokens.message);
    }

    // A reused catalog is already on disk. With no token source there is no file, and the later steps read an empty path as
    // "no tokens" (generating with --tokens pointing at a missing file fails).
    const hasTokenSource = input.rawTokensPath !== '' || input.tokenStrategy === 'reuse';

    if (capturedEntities && input.credentials) {
      const db = openPipelineDb();
      try {
        bindCatalogueCaptureToSession(db, extracted.sessionId, input.credentials, capturedEntities);
      } finally {
        db.close();
      }
    }
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
  } catch (error) {
    await cancelAndDrain();
    return fail('analyze extract', errorMessage(error));
  } finally {
    linked.dispose();
  }
}

async function fetchEntities(
  credentials: NonNullable<ExtractionInput['credentials']>,
  outDir: string,
  onCapture?: (entities: ExistingContentfulEntities) => void,
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
    if (!result.ok) return null;
    onCapture?.(result.entities);
    return result.path;
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

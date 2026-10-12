import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fetchAndPersistExistingContentfulEntities } from '@contentful/experience-design-system-backend-pipeline';
import { checkAgentAuth, type AgentName } from '@contentful/experience-design-system-generation';
import { parsePromptOverrides, resolvePromptOverride } from '@contentful/experience-design-system-backend-pipeline';
import {
  agentAuthMessage,
  applyProgressEvent,
  findSession,
  initialProgress,
  noComponentsMessage,
  parseExtractedCount,
  parseProgressLine,
  parseSessionLine,
} from './logic.js';
import { runTokenGeneration, spawnExtract, type TokenGenerationResult } from './processes.js';
import { runSelection } from './selection.js';
import type { ExtractionHandoff } from '@contentful/experience-design-system-types/handoff';
import type { ExtractionInput, ExtractionProgress, ExtractionResult } from './types.js';

type Failure = Extract<ExtractionResult, { ok: false }>;

/** The outside world the stage talks to, so the order of events can be tested without a network, an agent or a CLI. */
export interface ExtractionDeps {
  checkAgentAuth: typeof checkAgentAuth;
  fetchEntities: (credentials: NonNullable<ExtractionInput['credentials']>, outDir: string) => Promise<string | null>;
  spawnExtract: typeof spawnExtract;
  runTokenGeneration: typeof runTokenGeneration;
  runSelection: typeof runSelection;
}

const realDeps: ExtractionDeps = { checkAgentAuth, fetchEntities, spawnExtract, runTokenGeneration, runSelection };

const fail = (step: Failure['step'], message: string): Failure => ({ ok: false, step, message });
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Runs the stage. The jobs overlap exactly as they do in the legacy wizard:
 *
 *   entities fetch ───────┐
 *   __extract ── session= ┴─ selection agent (waits for the fetch) ──┐
 *        └──────────────────────────────── exits (composition done) ─┴─ result
 *   __generate tokens → print tokens   (only when the tokens are not being reused)
 *
 * Selection starts the moment the session id is printed, so it overlaps with composition. When more than one job
 * fails, the error reported is the first of: extract, no components, selection, token generation.
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

  // Token generation runs at the same time as everything else, as the wizard started it from an effect.
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

  const extracted = await deps.spawnExtract(
    {
      projectPath: input.projectPath,
      agent: input.agent,
      promptOverrides: input.promptOverrides,
      noCache: input.noCache,
    },
    {
      onStderrLine: (line) => {
        const event = parseProgressLine(line);
        if (event) update(applyProgressEvent(progress, event));
      },
      onStdoutLine: (line) => {
        const sessionId = parseSessionLine(line);
        if (sessionId) startSelection(sessionId);
      },
    },
  );

  const sessionId = findSession(extracted.stdout);
  if (!selection && sessionId) startSelection(sessionId);
  if (selection) await selection;
  if (!selection && entities) await entities;

  if (extracted.exitCode !== 0) return fail('analyze extract', extracted.stderr.trim() || 'Unknown error');
  if (parseExtractedCount(extracted.stderr) === 0)
    return fail('analyze extract', noComponentsMessage(input.projectPath));
  if (selectionError) return fail('selection agent', errorMessage(selectionError));

  const tokens = await tokenGeneration;
  if (tokens && !tokens.ok) return fail(tokens.step, tokens.message);

  if (!sessionId) return fail('analyze extract', 'The extract command did not report a session.');

  const extraction: ExtractionHandoff = {
    sessionId,
    outDir,
    tokensPath: tokens?.ok ? tokens.tokensPath : join(outDir, 'tokens.json'),
    tokenSessionId: tokens?.ok ? tokens.tokenSessionId : null,
    tokenCount: tokens?.ok ? tokens.tokenCount : 0,
    existingEntitiesPath,
    existingEntitiesStatus:
      progress.existingEntities === 'complete' || progress.existingEntities === 'failed'
        ? progress.existingEntities
        : 'idle',
    compositionPhase: progress.composition === 'cache-hit' ? 'cache-hit' : 'done',
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

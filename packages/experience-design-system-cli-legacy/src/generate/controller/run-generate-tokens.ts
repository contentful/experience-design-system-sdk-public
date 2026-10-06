import {
  AGENT_NAMES,
  agentSupportsBedrock,
  buildPrompt,
  createLocalCliAgentInvoker,
  isAgentName,
  parseTokenToolCallLines,
  resolveBinary,
} from '@contentful/experience-design-system-generation';
import {
  openPipelineDb,
  applyTokenToolCalls,
  computeTokenInputHash,
  lookupCache,
  storeCache,
  copyTokensFromCache,
} from '../../session/db.js';
import { hashPromptForSkill } from '../../session/cache-keys.js';
import { readExperiencesCredentials } from '../../credentials-store.js';
import { bindAnalyticsSessionId, exitWithAnalytics } from '../../analytics/index.js';
import { die, assertBinaryInPath } from '../../lib/cli-errors.js';
import { parsePromptOverrides, resolvePromptOverride } from '../../lib/prompt-overrides.js';
import { resolve } from 'node:path';
import { assertFileExists, readFileInline } from '../helpers/read-file-inline.js';
import { showGenerateView } from '../helpers/show-generate-view.js';
import { printFallbackInstructions } from '../helpers/print-fallback-instructions.js';
import { c } from '../../output/format.js';
import type { GenerateSubcommandOptions } from '../command.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export async function runGenerateTokens(opts: GenerateSubcommandOptions, _verbose: boolean): Promise<void> {
  const savedCreds = await readExperiencesCredentials();
  const agentName = opts.agent ?? savedCreds.agent;
  const model = opts.model ?? savedCreds.agentModel;
  if (!agentName || !isAgentName(agentName)) {
    die(
      `Error: no agent configured. Pass --agent <name> or run experiences setup. Accepted values: ${AGENT_NAMES.join(', ')}`,
    );
  }
  const agent = agentName;

  if (opts.bedrock && !agentSupportsBedrock(agent)) {
    die(`Error: --bedrock is not supported for --agent ${agent}`);
  }

  const { overrides: promptOverrides, errors: promptErrors } = parsePromptOverrides(opts.prompt ?? []);
  if (promptErrors.length > 0) die(`Error: ${promptErrors.join('; ')}`);
  let generatePrompt: string | undefined;
  const tokensOverride = promptOverrides.get('tokens');
  if (tokensOverride) {
    try {
      generatePrompt = await resolvePromptOverride(tokensOverride);
    } catch (error) {
      die(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!opts.rawTokens) {
    die('Error: --raw-tokens is required when using generate tokens');
  }
  await assertFileExists('--raw-tokens', opts.rawTokens);
  if (opts.tokens) await assertFileExists('--tokens', opts.tokens);
  if (opts.tokenMap) await assertFileExists('--token-map', opts.tokenMap);

  const [rawTokensInline, tokensInline, tokenMapInline] = await Promise.all([
    readFileInline(opts.rawTokens),
    readFileInline(opts.tokens),
    readFileInline(opts.tokenMap),
  ]);

  if (opts.dryRun) {
    const prompt = await buildPrompt({
      skill: 'tokens',
      mode: 'autonomous',
      rawTokensInline,
      rawTokensFilename: opts.rawTokens ? resolve(opts.rawTokens).split('/').pop() : undefined,
      tokensInline,
      tokenMapInline,
      outDir: process.cwd(),
      skillContentOverride: generatePrompt,
    });
    process.stdout.write(prompt + '\n');
    await exitWithAnalytics(0);
    return;
  }

  const binary = resolveBinary(agent);
  if (!(await assertBinaryInPath(binary))) {
    printFallbackInstructions({ agent, skill: 'tokens', sessionId: '' });
    await exitWithAnalytics(1);
    return;
  }

  const noCache = opts.cache === false || process.env.EDS_NO_CACHE === '1';
  const tokenInputContent = rawTokensInline ?? '';
  const tokenInputHash = computeTokenInputHash(tokenInputContent);

  const db = openPipelineDb();
  let sessionId: string | undefined;
  try {
    let resolvedSessionId = opts.session;
    if (!resolvedSessionId) {
      const s = db
        .prepare(
          `SELECT s.id FROM sessions s JOIN steps st ON st.session_id = s.id WHERE st.command = 'analyze extract' AND st.status = 'complete' ORDER BY st.started_at DESC LIMIT 1`,
        )
        .get() as { id: string } | undefined;
      if (s) {
        resolvedSessionId = s.id;
      } else {
        const { generateSessionId } = await import('../../session/session-id.js');
        const newId = generateSessionId();
        const now = new Date().toISOString();
        db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, NULL, ?, ?)').run(
          newId,
          now,
          now,
        );
        resolvedSessionId = newId;
      }
    }

    sessionId = resolvedSessionId;
    await bindAnalyticsSessionId(resolvedSessionId);

    const tokenPromptHash = await hashPromptForSkill('tokens', agent, model);
    if (!noCache) {
      const tokenCached = lookupCache(db, tokenInputHash, 'token_set', '__tokens__', tokenPromptHash);
      if (tokenCached) {
        copyTokensFromCache(db, tokenCached.sourceSessionId, resolvedSessionId);
        sessionId = resolvedSessionId;
        process.stderr.write(
          `Done: tokens reused from cache ${c.dim(`(source: ${tokenCached.sourceSessionId.slice(0, 12)})`)}\n`,
        );
        db.close();
        await showGenerateView({ skill: 'tokens', agent, sessionId });
        return;
      }
    }

    const prompt = await buildPrompt({
      skill: 'tokens',
      mode: 'autonomous',
      rawTokensInline,
      rawTokensFilename: opts.rawTokens ? resolve(opts.rawTokens).split('/').pop() : undefined,
      tokensInline,
      tokenMapInline,
      outDir: process.cwd(),
      skillContentOverride: generatePrompt,
    });

    const invoker = createLocalCliAgentInvoker();
    const result = await invoker.invoke({ agent, model, prompt, timeoutMs: DEFAULT_TIMEOUT_MS * 5 });

    if (result.timedOut) die(`Error: agent did not complete within ${(DEFAULT_TIMEOUT_MS * 5) / 60000} minutes`);
    if (result.exitCode !== 0) {
      if (result.stderr) process.stderr.write(result.stderr);
      die(`Error: agent exited with code ${result.exitCode}`);
    }

    const { calls: tokenCalls, warnings: tokenWarnings } = parseTokenToolCallLines(result.stdout);
    const tokenCount = tokenCalls.filter((tc) => tc.tool === 'set_token').length;
    if (tokenCount === 0) {
      process.stderr.write(
        `Error: agent produced no set_token calls.\nRun with --dry-run to inspect the prompt.\n\nAgent output:\n${result.stdout}\n`,
      );
      await exitWithAnalytics(1);
      return;
    }
    if (tokenWarnings.length > 0) {
      process.stderr.write(`Warnings:\n${tokenWarnings.map((w) => `  ${w}`).join('\n')}\n`);
    }

    applyTokenToolCalls(db, resolvedSessionId, tokenCalls, []);
    if (!noCache) storeCache(db, tokenInputHash, 'token_set', '__tokens__', resolvedSessionId, false, tokenPromptHash);
    sessionId = resolvedSessionId;

    const groupCount = tokenCalls.filter((tc) => tc.tool === 'set_group').length;
    process.stderr.write(`Done: ${tokenCount} tokens, ${groupCount} groups stored\n`);
  } finally {
    db.close();
  }

  await showGenerateView({ skill: 'tokens', agent, sessionId: sessionId ?? '' });
}

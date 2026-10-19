import { resolve } from 'node:path';
import {
  type AgentName,
  buildPrompt,
  bucketComponentsProps,
  computeComponentInputHash,
  createLocalCliAgentInvoker,
  getCliCacheVersion,
  hashContent,
  hashFile,
  invokeAgentWithOutput,
  loadRawComponents,
  lookupSelectCache,
  openPipelineDb,
  parseSelectToolCalls,
  storeSelectCache,
  stripPropProvenance,
} from '@contentful/experience-design-system-backend-pipeline';
import { findSkillPath } from './find-skill-path.js';

const SELECT_SKILL_PATH = findSkillPath('select-components.md');

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

type Decision = { decision: 'accepted' | 'rejected'; reason: string | null };

/**
 * The key the select cache stores decisions under: the prompt text, the agent and the model, so a cached answer is never
 * reused for a run made with a different prompt, agent or model. This is the legacy `hashPromptForSkill('select', …)`.
 * The skill file is found through the generation package, which ships it; backend-pipeline's own copy of that function
 * looks for a skills/ directory inside backend-pipeline, which does not exist, and throws.
 */
async function hashSelectPrompt(
  options: Pick<SelectionOptions, 'agent' | 'model' | 'promptPath' | 'promptText'>,
): Promise<string> {
  const promptHash = options.promptText
    ? hashContent(options.promptText)
    : options.promptPath
      ? await hashFile(resolve(options.promptPath))
      : await hashFile(SELECT_SKILL_PATH);
  return hashContent(`${promptHash}|${options.agent}|${options.model ?? ''}`);
}

export interface SelectionOptions {
  sessionId: string;
  agent: AgentName;
  model?: string;
  promptText?: string;
  promptPath?: string;
  noCache: boolean;
}

/**
 * The selection agent run, as the legacy wizard ran it.
 *
 * Reads the extracted components from the session database and skips the ones already decided (cache keyed by
 * component hash, prompt hash and CLI version). It asks the agent about the rest, then writes accepted or rejected to
 * raw_components and stores the new decisions in the cache in one transaction. Throws on a timeout, a non-zero exit,
 * or a database error.
 */
export async function runSelection(options: SelectionOptions): Promise<void> {
  const db = openPipelineDb();
  let components: ReturnType<typeof loadRawComponents>;
  const cachedDecisions = new Map<string, Decision>();
  const cliVersion = await getCliCacheVersion();
  const promptHash = await hashSelectPrompt(options);
  try {
    components = loadRawComponents(db, options.sessionId);
    if (!options.noCache) {
      for (const component of components) {
        const cached = lookupSelectCache(db, computeComponentInputHash(component), promptHash, cliVersion);
        if (cached) cachedDecisions.set(component.name, { decision: cached.decision, reason: cached.reason });
      }
    }
  } finally {
    db.close();
  }

  if (components.length === 0) return;

  const componentsToRun = components.filter((component) => !cachedDecisions.has(component.name));
  let calls: Array<{ name: string; tool: 'select_component' | 'reject_component'; reason?: string }> = [];

  if (componentsToRun.length > 0) {
    const invoker = createLocalCliAgentInvoker({});

    const prompt = await buildPrompt({
      skill: 'select',
      mode: 'autonomous',
      rawComponentsInline: JSON.stringify(
        componentsToRun.map((component) => ({ ...component, props: component.props.map(stripPropProvenance) })),
        null,
        2,
      ),
      propBucketsInline: JSON.stringify(bucketComponentsProps(componentsToRun)),
      outDir: process.cwd(),
      ...(options.promptText !== undefined
        ? { skillContentOverride: options.promptText }
        : { skillPathOverride: options.promptPath ?? SELECT_SKILL_PATH }),
    });
    const { result } = await invokeAgentWithOutput(
      invoker,
      { agent: options.agent, model: options.model, prompt, timeoutMs: DEFAULT_TIMEOUT_MS },
      false,
    );
    if (result.timedOut) throw new Error('selection agent timed out');
    if (result.exitCode !== 0) throw new Error(`selection agent exited with code ${result.exitCode}`);

    const parsed = parseSelectToolCalls(result.stdout);
    for (const warning of parsed.warnings) process.stderr.write(`Warning: selection agent: ${warning}\n`);
    calls = parsed.calls;
  }
  const byName = new Map(calls.map((call) => [call.name, call]));

  const writeDb = openPipelineDb();
  try {
    writeDb.exec('BEGIN');
    const update = writeDb.prepare(
      `UPDATE raw_components SET status = ?, reject_reason = ? WHERE session_id = ? AND component_id = ?`,
    );
    for (const component of components) {
      const cached = cachedDecisions.get(component.name);
      const call = byName.get(component.name);
      if (!cached && !call) continue;
      const rejected = cached ? cached.decision === 'rejected' : call!.tool === 'reject_component';
      const reason = cached ? cached.reason : (call!.reason ?? null);
      update.run(
        rejected ? 'rejected' : 'accepted',
        rejected ? reason : null,
        options.sessionId,
        component.component_id,
      );
      if (!cached) {
        storeSelectCache(
          writeDb,
          computeComponentInputHash(component),
          promptHash,
          cliVersion,
          rejected ? 'rejected' : 'accepted',
          rejected ? reason : null,
        );
      }
    }
    writeDb.exec('COMMIT');
  } catch (error) {
    writeDb.exec('ROLLBACK');
    throw error;
  } finally {
    writeDb.close();
  }
}

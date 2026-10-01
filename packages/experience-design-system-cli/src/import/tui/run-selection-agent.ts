import {
  buildPrompt,
  createLocalCliAgentInvoker,
  parseSelectToolCallLines,
  type AgentName,
} from '@contentful/experience-design-system-generation';
import { getDebugLogger } from '../../lib/debug-logger.js';
import { invokeAgentWithOutput } from '../../lib/agent-output.js';
import {
  computeComponentInputHash,
  getCliCacheVersion,
  loadRawComponents,
  lookupSelectCache,
  openPipelineDb,
  storeSelectCache,
} from '../../session/db.js';
import { hashPromptForSkill } from '../../session/cache-keys.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export async function runSelectionAgent(options: {
  sessionId: string;
  agent: AgentName;
  model?: string;
  promptText?: string;
  promptPath?: string;
  noCache?: boolean;
}): Promise<void> {
  const db = openPipelineDb();
  let components: Awaited<ReturnType<typeof loadRawComponents>>;
  const cachedDecisions = new Map<string, { decision: 'accepted' | 'rejected'; reason: string | null }>();
  const cliVersion = await getCliCacheVersion();
  const promptHash = await hashPromptForSkill(
    'select',
    options.agent,
    options.model,
    options.promptPath,
    [],
    options.promptText,
  );
  try {
    components = loadRawComponents(db, options.sessionId);
    if (!options.noCache) {
      for (const component of components) {
        const componentHash = computeComponentInputHash(component);
        const cached = lookupSelectCache(db, componentHash, promptHash, cliVersion);
        if (cached) {
          cachedDecisions.set(component.name, {
            decision: cached.decision,
            reason: cached.reason,
          });
        }
      }
    }
  } finally {
    db.close();
  }

  if (components.length === 0) return;

  const componentsToRun = components.filter((component) => !cachedDecisions.has(component.name));
  let calls: Array<{ name: string; tool: 'select_component' | 'reject_component'; reason?: string }> = [];

  if (componentsToRun.length > 0) {
    const invoker = createLocalCliAgentInvoker({
      onDebugEvent: (name, payload) => getDebugLogger().event('agent', name, payload),
    });

    const prompt = await buildPrompt({
      skill: 'select',
      mode: 'autonomous',
      rawComponentsInline: JSON.stringify(componentsToRun, null, 2),
      outDir: process.cwd(),
      ...(options.promptText !== undefined ? { skillContentOverride: options.promptText } : {}),
      ...(options.promptText === undefined && options.promptPath ? { skillPathOverride: options.promptPath } : {}),
    });
    const { result } = await invokeAgentWithOutput(
      invoker,
      { agent: options.agent, model: options.model, prompt, timeoutMs: DEFAULT_TIMEOUT_MS },
      false,
    );
    if (result.timedOut) throw new Error('selection agent timed out');
    if (result.exitCode !== 0) throw new Error(`selection agent exited with code ${result.exitCode}`);

    const parsed = parseSelectToolCallLines(result.stdout);
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

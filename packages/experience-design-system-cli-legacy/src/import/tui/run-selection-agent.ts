import { bucketComponentsProps } from '@contentful/experience-design-system-extraction';
import {
  buildPrompt,
  createLocalCliAgentInvoker,
  parseSelectToolCallLines,
  type AgentName,
} from '@contentful/experience-design-system-generation';
import { getDebugLogger } from '../../lib/debug-logger.js';
import { invokeAgentWithOutput } from '../../lib/agent-output.js';
import { loadRawComponents, openPipelineDb, stripPropProvenance } from '../../session/db.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export async function runSelectionAgent(options: {
  sessionId: string;
  agent: AgentName;
  model?: string;
  promptText?: string;
  promptPath?: string;
}): Promise<void> {
  const db = openPipelineDb();
  let components: Awaited<ReturnType<typeof loadRawComponents>>;
  try {
    components = loadRawComponents(db, options.sessionId);
  } finally {
    db.close();
  }

  if (components.length === 0) return;

  const invoker = createLocalCliAgentInvoker({
    onDebugEvent: (name, payload) => getDebugLogger().event('agent', name, payload),
  });

  const selectBuckets = bucketComponentsProps(components);
  for (const assignment of selectBuckets) {
    getDebugLogger().event('analyze', 'prop-buckets.select', { ...assignment });
  }

  const prompt = await buildPrompt({
    skill: 'select',
    mode: 'autonomous',
    rawComponentsInline: JSON.stringify(
      components.map((component) => ({ ...component, props: component.props.map(stripPropProvenance) })),
      null,
      2,
    ),
    propBucketsInline: JSON.stringify(selectBuckets),
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
  const byName = new Map(parsed.calls.map((call) => [call.name, call]));

  const writeDb = openPipelineDb();
  try {
    writeDb.exec('BEGIN');
    const update = writeDb.prepare(
      `UPDATE raw_components SET status = ?, reject_reason = ? WHERE session_id = ? AND component_id = ?`,
    );
    for (const component of components) {
      const call = byName.get(component.name);
      if (!call) continue;
      const rejected = call.tool === 'reject_component';
      update.run(
        rejected ? 'rejected' : 'accepted',
        rejected ? (call.reason ?? null) : null,
        options.sessionId,
        component.component_id,
      );
    }
    writeDb.exec('COMMIT');
  } catch (error) {
    writeDb.exec('ROLLBACK');
    throw error;
  } finally {
    writeDb.close();
  }
}

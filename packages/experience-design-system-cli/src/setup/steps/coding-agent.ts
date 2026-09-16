import { AGENT_DEFS, type AgentDefinition } from '../../lib/agent-definitions.js';
import { emit, type AgentSetupResult, type SetupActionDependencies } from '../lib/types.js';

async function promptCodexModel(dependencies: SetupActionDependencies): Promise<string | undefined> {
  if (dependencies.env['OPENAI_API_KEY']) return undefined;
  emit(dependencies, 'warning', 'No OPENAI_API_KEY — using ChatGPT account authentication.');
  emit(dependencies, 'info', 'Tip: run codex then type /model to browse all available models.');
  const model = (await dependencies.ask('Model name (optional - press Enter for Codex default): ')).trim();
  return model || undefined;
}

export async function runAgentSetup(dependencies: SetupActionDependencies): Promise<AgentSetupResult> {
  emit(dependencies, 'info', 'Experiences import uses a coding agent to generate component definitions.');
  const found = (
    await Promise.all(
      AGENT_DEFS.map(async (agent) => ((await dependencies.binaryExists(agent.binary)) ? agent : undefined)),
    )
  ).filter((agent): agent is AgentDefinition => agent !== undefined);
  if (found.length === 1) {
    const selected = found[0]!;
    emit(dependencies, 'success', `${selected.name} (${selected.binary}) found`);
    const agentModel = selected.binary === 'codex' ? await promptCodexModel(dependencies) : undefined;
    return { agent: selected.binary, agentModel, passed: true };
  }
  if (found.length > 1) {
    const index = await dependencies.choose(
      'Multiple coding agents found. Choose one to use as the default:',
      found.map((agent) => ({ label: agent.name, description: agent.binary })),
    );
    if (index === undefined) return { agent: undefined, agentModel: undefined, passed: false };
    const selected = found[index] ?? found[0]!;
    const agentModel = selected.binary === 'codex' ? await promptCodexModel(dependencies) : undefined;
    return { agent: selected.binary, agentModel, passed: true };
  }

  emit(dependencies, 'warning', 'No coding agent found on PATH');
  const installable = AGENT_DEFS.slice(0, 3);
  const index = await dependencies.choose(
    'Choose one to install:',
    installable.map((agent) => ({ label: agent.name, description: agent.installHint })),
  );
  const selected = index === undefined ? undefined : installable[index];
  if (!selected) return { agent: undefined, agentModel: undefined, passed: false };
  const packageName =
    selected.binary === 'claude'
      ? '@anthropic-ai/claude-code'
      : selected.binary === 'codex'
        ? '@openai/codex'
        : 'opencode-ai';
  const installed = await dependencies.run('npm', ['install', '-g', packageName]);
  if (installed.exitCode !== 0 || !(await dependencies.binaryExists(selected.binary))) {
    emit(dependencies, 'failure', 'Install failed');
    return { agent: undefined, agentModel: undefined, passed: false };
  }
  emit(dependencies, 'success', `${selected.name} installed`);
  const agentModel = selected.binary === 'codex' ? await promptCodexModel(dependencies) : undefined;
  return { agent: selected.binary, agentModel, passed: true };
}

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput } from '@inkjs/ui';
import type { AgentName } from '@contentful/experience-design-system-generation';
import { AGENT_DEFS, INSTALLABLE_AGENTS, installHint, type AgentDefinition } from '../../lib/agent-definitions.js';
import { readExperiencesCredentials, writeExperiencesCredentials } from '../../credentials-store.js';
import { binaryExists, runSpawn } from '../lib/shell.js';
import { StepLayout, StepSuccess, StepWarning, type StepDone } from './StepLayout.js';

const AGENT_HELP = 'Experiences import requires a coding agent to generate component definitions.';

/** The value Select reports for the trailing Skip row, which no agent can collide with. */
const SKIP_VALUE = '\u0000skip';

export async function detectAgents(
  exists: (binary: string) => Promise<boolean> = binaryExists,
): Promise<AgentDefinition[]> {
  const found = await Promise.all(AGENT_DEFS.map(async (agent) => ((await exists(agent.binary)) ? agent : undefined)));
  return found.filter((agent): agent is AgentDefinition => agent !== undefined);
}

/** Codex needs a model only when it authenticates through a ChatGPT account. */
export function needsCodexModel(agent: AgentName, env: NodeJS.ProcessEnv): boolean {
  return agent === 'codex' && !env['OPENAI_API_KEY'];
}

type Phase =
  | { kind: 'detecting' }
  | { kind: 'choose'; found: AgentDefinition[] }
  | { kind: 'install-choice' }
  | { kind: 'installing'; agent: AgentDefinition }
  | { kind: 'model'; agent: AgentDefinition }
  | { kind: 'failed'; message: string };

export type CodingAgentDeps = {
  binaryExists: typeof binaryExists;
  run: typeof runSpawn;
  env: NodeJS.ProcessEnv;
};

type CodingAgentScreenProps = {
  onDone: StepDone;
  /** Injected so tests can drive detection and install without spawning. */
  deps?: CodingAgentDeps;
};

export function CodingAgentScreen({ onDone, deps }: CodingAgentScreenProps): React.ReactElement {
  const { binaryExists: exists, run, env } = deps ?? { binaryExists, run: runSpawn, env: process.env };
  const [phase, setPhase] = useState<Phase>({ kind: 'detecting' });
  const [notes, setNotes] = useState<React.ReactNode[]>([]);
  const startedRef = useRef(false);

  /** Persist the chosen agent, replacing any stale model from a previous run. */
  const save = async (agent: AgentName, agentModel: string | undefined): Promise<void> => {
    const stored = await readExperiencesCredentials();
    const { agentModel: _stale, ...rest } = stored;
    await writeExperiencesCredentials({ ...rest, agent, ...(agentModel ? { agentModel } : {}) });
    onDone('completed');
  };

  const afterSelection = (agent: AgentDefinition): void => {
    if (needsCodexModel(agent.binary, env)) {
      setPhase({ kind: 'model', agent });
      return;
    }
    void save(agent.binary, undefined);
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const found = await detectAgents(exists);
      if (found.length === 1) {
        const only = found[0]!;
        setNotes([<StepSuccess key="found">{`${only.name} (${only.binary}) found`}</StepSuccess>]);
        afterSelection(only);
        return;
      }
      if (found.length > 1) {
        setPhase({ kind: 'choose', found });
        return;
      }
      setNotes([<StepWarning key="none">No coding agent found on PATH</StepWarning>]);
      setPhase({ kind: 'install-choice' });
    })();
    // The screen drives its own detection once; re-running would restart it.
  }, []);

  const install = async (agent: AgentDefinition): Promise<void> => {
    setPhase({ kind: 'installing', agent });
    const result = await run('npm', ['install', '-g', agent.packageName]);
    if (result.exitCode !== 0 || !(await exists(agent.binary))) {
      setPhase({ kind: 'failed', message: 'Install failed' });
      onDone('failed');
      return;
    }
    setNotes((current) => [...current, <StepSuccess key="installed">{`${agent.name} installed`}</StepSuccess>]);
    afterSelection(agent);
  };

  const chooser = (
    question: string,
    options: AgentDefinition[],
    describe: (agent: AgentDefinition) => string,
    onPick: (agent: AgentDefinition | undefined) => void,
  ): React.ReactNode => (
    <Box flexDirection="column">
      <Text>{question}</Text>
      <Box marginTop={1}>
        <Select
          options={[
            ...options.map((agent) => ({ label: `${agent.name}  ${describe(agent)}`, value: agent.binary })),
            { label: 'Skip', value: SKIP_VALUE },
          ]}
          onChange={(value) => onPick(options.find((agent) => agent.binary === value))}
        />
      </Box>
    </Box>
  );

  if (phase.kind === 'choose') {
    return (
      <StepLayout
        helpText={AGENT_HELP}
        prompt={chooser(
          'Multiple coding agents found. Choose one to use as the default:',
          phase.found,
          (agent) => agent.binary,
          (agent) => (agent ? afterSelection(agent) : onDone('skipped')),
        )}
      >
        {notes}
      </StepLayout>
    );
  }

  if (phase.kind === 'install-choice') {
    return (
      <StepLayout
        helpText={AGENT_HELP}
        prompt={chooser('Choose one to install:', [...INSTALLABLE_AGENTS], installHint, (agent) =>
          agent ? void install(agent) : onDone('skipped'),
        )}
      >
        {notes}
      </StepLayout>
    );
  }

  if (phase.kind === 'model') {
    return (
      <StepLayout
        helpText={AGENT_HELP}
        prompt={
          <Box>
            <Text>Model name (optional - press Enter for Codex default): </Text>
            <TextInput
              key="model-input"
              onSubmit={(value) => void save(phase.agent.binary, value.trim() || undefined)}
            />
          </Box>
        }
      >
        {[
          ...notes,
          <StepWarning key="no-key">No OPENAI_API_KEY — using ChatGPT account authentication.</StepWarning>,
          <Text key="tip" dimColor>
            Tip: run codex then type /model to browse all available models.
          </Text>,
        ]}
      </StepLayout>
    );
  }

  if (phase.kind === 'installing') {
    return (
      <StepLayout helpText={AGENT_HELP}>
        {[...notes, <Text key="installing">{`Installing ${phase.agent.name}…`}</Text>]}
      </StepLayout>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <StepLayout helpText={AGENT_HELP}>{[...notes, <Text key="failed">{`✗ ${phase.message}`}</Text>]}</StepLayout>
    );
  }

  return <Text dimColor>Looking for a coding agent…</Text>;
}

import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { AGENT_NAMES, type AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { PALETTE } from '../../home/home.theme.js';
import { ControlHints } from '../../control-hints.js';
import { startDebugRun, finishDebugRun } from '../../debug-store.js';
import { FieldForm, type FormField, type FormNotice } from '../shared/FieldForm.js';
import { AGENT_HINTS, AGENT_LABELS, readAgentConfig, writeAgentConfig, type AgentConfig } from './agent-store.js';

const MODEL_FIELDS: readonly FormField<'model'>[] = [
  { key: 'model', label: 'Model', hint: '(empty: the agent’s own default)' },
];

// The first row is the default-agent choice; the five agents follow.
type Row = { kind: 'default' } | { kind: 'agent'; name: AgentName };
const ROWS: readonly Row[] = [{ kind: 'default' }, ...AGENT_NAMES.map((name): Row => ({ kind: 'agent', name }))];

/** One agent's own settings. Saving writes the whole agent config, so the default agent and other agents are kept. */
function AgentForm({
  name,
  config,
  setConfig,
  onBack,
}: {
  name: AgentName;
  config: AgentConfig;
  setConfig: (config: AgentConfig) => void;
  onBack: () => void;
}): React.ReactElement {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<FormNotice | null>(null);

  const save = (): void => {
    setSaving(true);
    setNotice(null);
    writeAgentConfig(config)
      .then(() => setNotice({ kind: 'success', text: `${AGENT_LABELS[name]} settings saved` }))
      .catch((err: unknown) =>
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to save' }),
      )
      .finally(() => setSaving(false));
  };

  return (
    <FieldForm
      title={AGENT_LABELS[name]}
      subtitle={`Runs the \`${AGENT_HINTS[name]}\` command. ${config.defaultAgent === name ? 'This is the default agent.' : ''}`.trim()}
      fields={MODEL_FIELDS}
      values={{ model: config.agents[name].model }}
      onChange={(_key, value) => {
        setConfig({ ...config, agents: { ...config.agents, [name]: { model: value } } });
        setNotice(null);
      }}
      onSave={save}
      onQuit={onBack}
      notice={notice}
      busy={saving}
    />
  );
}

/**
 * Settings > Configuration > Agents: which coding agent the CLI uses, and each agent's own settings. Enter on an agent
 * opens its form; the first row picks the default agent (←/→ or Enter cycles it, and the change is saved at once).
 */
export function AgentsScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [focus, setFocus] = useState(0);
  const [open, setOpen] = useState<AgentName | null>(null);
  const [notice, setNotice] = useState<FormNotice | null>(null);

  useEffect(() => {
    void readAgentConfig().then((loaded) => {
      setConfig(loaded);
      startDebugRun({
        flow: 'settings/agents',
        step: '01-agents',
        menuOption: 'Configuration > Agents',
        inputs: { default_agent: loaded.defaultAgent },
      });
    });
  }, []);

  const cycleDefault = (step: 1 | -1): void => {
    if (!config) return;
    const index = AGENT_NAMES.indexOf(config.defaultAgent);
    const next = { ...config, defaultAgent: AGENT_NAMES[(index + step + AGENT_NAMES.length) % AGENT_NAMES.length]! };
    setConfig(next);
    // Saved straight away: this row is a choice, not a field being typed into.
    writeAgentConfig(next)
      .then(() => setNotice({ kind: 'success', text: `Default agent is now ${AGENT_LABELS[next.defaultAgent]}` }))
      .catch((err: unknown) =>
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to save' }),
      );
  };

  useInput((input, key) => {
    if (!config || open) return;
    const row = ROWS[focus]!;

    if (key.upArrow) {
      setFocus((i) => (i - 1 + ROWS.length) % ROWS.length);
      return;
    }
    if (key.downArrow || key.tab) {
      setFocus((i) => (i + 1) % ROWS.length);
      return;
    }
    if (row.kind === 'default' && key.leftArrow) {
      cycleDefault(-1);
      return;
    }
    if (row.kind === 'default' && key.rightArrow) {
      cycleDefault(1);
      return;
    }
    if (key.return) {
      if (row.kind === 'default') cycleDefault(1);
      else setOpen(row.name);
      return;
    }
    if (key.escape || input === 'q') {
      void finishDebugRun({ outputs: { default_agent: config.defaultAgent }, status: 'success', exitMethod: 'saved' });
      onDone();
    }
  });

  if (!config) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Agents</Text>
        <Text> </Text>
        <Text color={PALETTE.accent}>Loading...</Text>
      </Box>
    );
  }

  if (open) {
    return <AgentForm name={open} config={config} setConfig={setConfig} onBack={() => setOpen(null)} />;
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Agents</Text>
      <Text color={PALETTE.muted}>The coding agent the CLI runs, and the settings for each one.</Text>
      <Text> </Text>
      {ROWS.map((row, index) => {
        const isFocused = index === focus;
        const pointer = <Text color={isFocused ? PALETTE.accent : undefined}>{isFocused ? '❯' : ' '}</Text>;
        if (row.kind === 'default') {
          return (
            <Box key="default" flexDirection="column" marginBottom={1}>
              <Box gap={1}>
                {pointer}
                <Text bold={isFocused} color={isFocused ? PALETTE.accent : PALETTE.muted}>
                  Default agent
                </Text>
                <Text bold>{`‹ ${AGENT_LABELS[config.defaultAgent]} ›`}</Text>
              </Box>
            </Box>
          );
        }
        const model = config.agents[row.name].model;
        return (
          <Box key={row.name} gap={1}>
            {pointer}
            <Box width={16} flexShrink={0}>
              <Text bold={isFocused} color={isFocused ? PALETTE.accent : undefined}>
                {AGENT_LABELS[row.name]}
              </Text>
            </Box>
            <Text color={PALETTE.muted}>{model ? `model: ${model}` : 'model: default'}</Text>
            {row.name === config.defaultAgent && <Text color={PALETTE.success}>(default)</Text>}
          </Box>
        );
      })}
      {notice && (
        <>
          <Text> </Text>
          <Text color={notice.kind === 'success' ? PALETTE.success : PALETTE.error}>
            {notice.kind === 'success' ? '✓' : '✗'} {notice.text}
          </Text>
        </>
      )}
      <Text> </Text>
      <ControlHints
        hints={
          ROWS[focus]!.kind === 'default'
            ? [
                { keys: '↑/↓', label: 'move' },
                { keys: '←/→', label: 'change default agent' },
                { keys: 'Esc/q', label: 'back' },
              ]
            : [
                { keys: '↑/↓', label: 'move' },
                { keys: '⏎', label: 'open' },
                { keys: 'Esc/q', label: 'back' },
              ]
        }
      />
    </Box>
  );
}

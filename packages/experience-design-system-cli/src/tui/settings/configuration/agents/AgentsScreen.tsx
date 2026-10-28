import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { AGENT_NAMES, type AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { PALETTE } from '@tui/theme.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { startDebugRun, finishDebugRun } from '../../../debug-store.js';
import type { FormNotice } from '@tui/shared/components/FieldForm.js';
import { createTrail, diffSnapshots, scrubError, type Snapshot } from '@tui/shared/debug-trail.js';
import { agentSnapshot, describeAgents, type AgentEnvironment } from './agent-debug.js';
import { AGENT_LABELS, readAgentConfig, writeAgentConfig, type AgentConfig } from './agent-store.js';
import { inspectAgent, panelRows, type AgentCheck } from './agent-status.js';
import { AgentDetail } from './AgentDetail.js';
import { AgentStatusBadge, TONE_COLOR } from './AgentStatusBadge.js';

const NAME_WIDTH = 16;
const PANEL_LABEL_WIDTH = 'Command'.length;

/**
 * Settings > Configuration > Agents. The list holds only what is needed to pick an agent: the name, a star on the default,
 * and a one-word status. Below it, a panel shows the full detail for the focused agent and follows the cursor, so nothing
 * has to be opened to read it. The "Default agent" line at the top is read-only: ↑/↓ move through the agents, Enter makes
 * the focused one the default (saved at once), and → opens its own screen, where its path and model are edited and the
 * test is run.
 */
export function AgentsScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [focus, setFocus] = useState(0);
  const [open, setOpen] = useState<AgentName | null>(null);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Partial<Record<AgentName, AgentCheck[]>>>({});
  // What this visit adds to the debug log: what the user did, the settings it opened with, and the last error. The agent's
  // own screen records into the same trail, since the logger keeps one run at a time and this screen owns it.
  const visit = useRef({
    trail: createTrail(),
    before: undefined as Snapshot | undefined,
    environment: undefined as Record<AgentName, AgentEnvironment> | undefined,
    error: '',
  }).current;

  // One quick inspection per agent when the screen opens, filled in as each answers. No prompts, so no tokens.
  const inspectAll = (loaded: AgentConfig): void => {
    for (const name of AGENT_NAMES) {
      void inspectAgent(name, loaded.agents[name].binary).then((result) =>
        setChecks((previous) => ({ ...previous, [name]: result })),
      );
    }
  };

  useEffect(() => {
    readAgentConfig()
      .then((loaded) => {
        setConfig(loaded);
        inspectAll(loaded);
        visit.before = agentSnapshot(loaded);
        // The run starts now so an early Esc still leaves a log. The environment takes a few probes, so it is gathered
        // in the background and written with the outputs.
        startDebugRun({
          flow: 'settings/agents',
          step: '01-agents',
          menuOption: 'Configuration > Agents',
          inputs: { ...visit.before, default_chosen: loaded.defaultChosen ?? false },
        });
        void describeAgents(loaded).then((found) => {
          visit.environment = found;
        });
      })
      .catch((err: unknown) => {
        // Start a run anyway: a settings file that cannot be read is what someone would send us a log about.
        visit.error = scrubError(err, []);
        startDebugRun({ flow: 'settings/agents', step: '01-agents', menuOption: 'Configuration > Agents', inputs: {} });
        setLoadError(visit.error);
      });
  }, []);

  // Finishes the log from the settings as they are now. Every way out of the screen goes through here.
  const endVisit = (current: AgentConfig | null): void => {
    const after = current ? agentSnapshot(current) : undefined;
    const change = visit.before && after ? diffSnapshots(visit.before, after) : { changed: false, changed_fields: [] };
    void finishDebugRun({
      outputs: {
        ...(after ?? {}),
        ...change,
        actions: visit.trail.entries(),
        // Missing only when the user left before the probes finished.
        ...(visit.environment ? { agents: visit.environment } : {}),
        ...(visit.error ? { error: visit.error } : {}),
      },
      status: visit.error ? 'error' : 'success',
      exitMethod: change.changed ? 'saved' : 'discarded',
    });
  };

  const makeDefault = (name: AgentName): void => {
    if (!config || saving) return;
    if (name === config.defaultAgent) {
      setNotice({ kind: 'success', text: `${AGENT_LABELS[name]} is already the default agent` });
      return;
    }
    // The star only moves once the write has worked, so a failed save cannot leave the screen showing the wrong agent.
    setSaving(true);
    setNotice(null);
    writeAgentConfig({ ...config, defaultAgent: name, defaultChosen: true })
      .then(() => {
        setConfig((current) => (current ? { ...current, defaultAgent: name, defaultChosen: true } : current));
        setNotice({ kind: 'success', text: `Default agent is now ${AGENT_LABELS[name]}` });
        visit.trail.record(`made ${name} the default`);
      })
      .catch((err: unknown) => {
        visit.error = scrubError(err, []);
        visit.trail.record(`making ${name} the default failed`);
        setNotice({ kind: 'error', text: `Default agent not changed: ${visit.error}` });
      })
      .finally(() => setSaving(false));
  };

  useInput((input, key) => {
    // With the settings unreadable there is nothing to show, so the only thing left to do is go back.
    if (loadError && (key.escape || input === 'q')) {
      endVisit(null);
      onDone();
      return;
    }
    if (!config || open || saving) return;
    const focused = AGENT_NAMES[focus]!;

    // A confirmation is about the last thing done, so it goes as soon as the user moves on.
    if (key.upArrow || key.downArrow || key.tab) setNotice(null);

    if (key.upArrow) {
      setFocus((i) => (i - 1 + AGENT_NAMES.length) % AGENT_NAMES.length);
      return;
    }
    if (key.downArrow || key.tab) {
      setFocus((i) => (i + 1) % AGENT_NAMES.length);
      return;
    }
    if (key.return) {
      makeDefault(focused);
      return;
    }
    if (key.rightArrow) {
      setNotice(null);
      setOpen(focused);
      return;
    }
    if (key.escape || input === 'q') {
      endVisit(config);
      onDone();
    }
  });

  if (!config) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Settings › Configuration › Agents</Text>
        <Text> </Text>
        {loadError ? (
          <>
            <Text color={PALETTE.error}>✗ Could not read the settings: {loadError}</Text>
            <Text> </Text>
            <ControlHints hints={[{ keys: 'Esc/q', label: 'back' }]} />
          </>
        ) : (
          <Text color={PALETTE.accent}>Loading...</Text>
        )}
      </Box>
    );
  }

  if (open) {
    return (
      <AgentDetail
        name={open}
        config={config}
        setConfig={setConfig}
        record={(action, error) => {
          visit.trail.record(action);
          if (error !== undefined) visit.error = scrubError(error, []);
        }}
        onBack={() => {
          setOpen(null);
          // The path or login may have changed on the agent's screen, so the rows are checked again.
          void readAgentConfig().then((saved) => {
            setConfig(saved);
            inspectAll(saved);
          });
        }}
      />
    );
  }

  const focusedAgent = AGENT_NAMES[focus]!;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings › Configuration › Agents</Text>
      <Text> </Text>
      <Text color={PALETTE.muted}>The coding agent the CLI runs, and what was found for each one.</Text>
      <Text> </Text>

      <Box gap={1}>
        <Text color={PALETTE.muted}>Default agent</Text>
        <Text bold>{AGENT_LABELS[config.defaultAgent]}</Text>
        {saving && <Text color={PALETTE.accent}>… saving</Text>}
      </Box>

      <Box marginTop={1} gap={1}>
        <Text> </Text>
        <Text> </Text>
        <Box width={NAME_WIDTH} flexShrink={0}>
          <Text color={PALETTE.muted}>AGENT</Text>
        </Box>
        <Text color={PALETTE.muted}>STATUS</Text>
      </Box>
      {AGENT_NAMES.map((name) => {
        const isFocused = focusedAgent === name;
        return (
          <Box key={name} gap={1}>
            <Text color={isFocused ? PALETTE.accent : undefined}>{isFocused ? '❯' : ' '}</Text>
            <Text color={PALETTE.success}>{name === config.defaultAgent ? '★' : ' '}</Text>
            <Box width={NAME_WIDTH} flexShrink={0}>
              <Text bold={isFocused} color={isFocused ? PALETTE.accent : undefined}>
                {AGENT_LABELS[name]}
              </Text>
            </Box>
            <AgentStatusBadge name={name} checks={checks[name]} binary={config.agents[name].binary} />
          </Box>
        );
      })}

      <Box flexDirection="column" marginTop={1}>
        <Text color={PALETTE.muted}>{`─ ${AGENT_LABELS[focusedAgent]} ${'─'.repeat(30)}`}</Text>
        {panelRows(focusedAgent, checks[focusedAgent], config.agents[focusedAgent]).map((row) => (
          <Box key={row.label} gap={1} paddingLeft={1}>
            <Box width={PANEL_LABEL_WIDTH} flexShrink={0}>
              <Text color={PALETTE.muted}>{row.label}</Text>
            </Box>
            <Text color={TONE_COLOR[row.tone]}>{row.value}</Text>
          </Box>
        ))}
      </Box>

      {notice && (
        <>
          <Text> </Text>
          <Text bold color={notice.kind === 'success' ? PALETTE.success : PALETTE.error}>
            {notice.kind === 'success' ? '✓' : '✗'} {notice.text}
          </Text>
        </>
      )}
      <Text> </Text>
      <ControlHints
        hints={[
          { keys: '↑/↓', label: 'move' },
          { keys: '⏎', label: 'make default' },
          { keys: '→', label: 'settings and test' },
          { keys: 'Esc/q', label: 'back' },
        ]}
      />
    </Box>
  );
}

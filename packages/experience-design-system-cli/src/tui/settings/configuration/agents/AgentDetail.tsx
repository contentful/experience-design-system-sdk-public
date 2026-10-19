import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { AGENT_BINARIES, type AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { PALETTE } from '../../../theme.js';
import {
  FieldForm,
  FormReadOnlyRow,
  formLabelWidth,
  type FormAction,
  type FormField,
  type FormNotice,
} from '../../shared/FieldForm.js';
import { AGENT_LABELS, writeAgentConfig, type AgentConfig } from './agent-store.js';
import {
  defaultModelLabel,
  inspectAgent,
  statusRows,
  testAgent,
  testOutcome,
  type AgentCheck,
} from './agent-status.js';
import { TONE_COLOR } from './AgentStatusBadge.js';
import { applyBinaryOverrides } from './apply-binary-overrides.js';

// One agent's screen. The form (command path, model, Run test) is the shared FieldForm, which owns editing, saving and the
// cursor. Underneath it, STATUS is read-only: what was found, never focusable.

type Field = 'binary' | 'model';

const fields = (name: AgentName): readonly FormField<Field>[] => [
  { key: 'binary', label: 'Command path', hint: `(empty: \`${AGENT_BINARIES[name]}\` from the PATH)` },
  { key: 'model', label: 'Model', hint: `(empty: ${defaultModelLabel(name)})` },
];

// How long the command path must sit unchanged before it is checked.
const INSPECT_DELAY_MS = 400;

/** The heading over the read-only block, with a note saying it cannot be edited. */
function StatusHeading(): React.ReactElement {
  return (
    <Box gap={1}>
      <Text bold color={PALETTE.muted}>
        STATUS
      </Text>
      <Text color={PALETTE.muted}>· read only</Text>
    </Box>
  );
}

/**
 * One agent's screen: what was found for it, its two settings, and the test. Saving writes the whole agent config, so the
 * default agent and the other agents are kept. The test uses the values on screen, saved or not.
 */
export function AgentDetail({
  name,
  config,
  setConfig,
  onBack,
  record,
}: {
  name: AgentName;
  config: AgentConfig;
  setConfig: (config: AgentConfig) => void;
  onBack: () => void;
  /** Adds a line to the debug log of this visit. The Agents list owns the log, since it is the screen that is open. */
  record: (action: string, error?: unknown) => void;
}): React.ReactElement {
  const settings = config.agents[name];
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [checks, setChecks] = useState<AgentCheck[] | undefined>(undefined);

  // Quick check on open, and again once the user pauses typing the path, so they see what the path they typed would do.
  // Waiting for a pause keeps half-typed paths from each spawning `which`, `--version` and (for claude) an auth check.
  useEffect(() => {
    let active = true;
    setChecks(undefined);
    const timer = setTimeout(() => {
      void inspectAgent(name, settings.binary).then((result) => active && setChecks(result));
    }, INSPECT_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [name, settings.binary]);

  const save = (): void => {
    setSaving(true);
    setNotice(null);
    writeAgentConfig(config)
      .then(() => {
        applyBinaryOverrides(config);
        record(`saved ${name}`);
        setNotice({ kind: 'success', text: `Saved: ${AGENT_LABELS[name]} settings are written to config.json` });
      })
      .catch((err: unknown) => {
        record(`saving ${name} failed`, err);
        setNotice({ kind: 'error', text: `Not saved: ${err instanceof Error ? err.message : String(err)}` });
      })
      .finally(() => setSaving(false));
  };

  const runTest = (): void => {
    setTesting(true);
    setNotice(null);
    testAgent(name, settings.binary, settings.model)
      .then((result) => {
        setChecks(result);
        const outcome = testOutcome(result);
        if (!outcome || !outcome.ok)
          record(`test of ${name} failed: ${outcome?.text ?? 'the agent could not be started'}`);
        // A test that stopped at the path or version check never reached the prompt, so say what blocked it.
        setNotice(
          outcome
            ? { kind: outcome.ok ? 'success' : 'error', text: outcome.text }
            : { kind: 'error', text: 'Test not run: the agent could not be started (see Status)' },
        );
      })
      .catch((err: unknown) => {
        record(`test of ${name} could not run`, err);
        setNotice({ kind: 'error', text: `Test could not run: ${err instanceof Error ? err.message : String(err)}` });
      })
      .finally(() => setTesting(false));
  };

  const action: FormAction = {
    label: 'Run test',
    description: 'sends one small prompt (uses a few tokens)',
    running: testing,
    hint: 'run test',
    onRun: runTest,
  };

  const formFields = fields(name);
  const labelWidth = formLabelWidth([...formFields, action]);

  return (
    <FieldForm
      title={AGENT_LABELS[name]}
      subtitle={
        config.defaultAgent === name ? 'This is the default agent.' : `Runs the \`${AGENT_BINARIES[name]}\` command.`
      }
      fields={formFields}
      values={{ binary: settings.binary, model: settings.model }}
      onChange={(key, value) => {
        setConfig({ ...config, agents: { ...config.agents, [name]: { ...settings, [key]: value } } });
        setNotice(null);
        record(`edited ${name}.${key}`);
      }}
      onSave={save}
      onQuit={onBack}
      actions={[action]}
      notice={testing ? null : notice}
      busy={saving || testing}
    >
      <Box flexDirection="column" marginTop={1}>
        <StatusHeading />
        {statusRows(name, checks, settings.binary).map((row) => (
          <FormReadOnlyRow key={row.label} label={row.label} labelWidth={labelWidth}>
            <Text color={TONE_COLOR[row.tone]}>{row.value}</Text>
          </FormReadOnlyRow>
        ))}
      </Box>
    </FieldForm>
  );
}

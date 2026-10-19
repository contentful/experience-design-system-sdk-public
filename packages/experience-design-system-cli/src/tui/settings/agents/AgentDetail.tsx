import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { PALETTE } from '../../home/home.theme.js';
import { ControlHints } from '../../control-hints.js';
import type { FormNotice } from '../shared/FieldForm.js';
import { AGENT_HINTS, AGENT_LABELS, writeAgentConfig, type AgentConfig } from './agent-store.js';
import {
  defaultModelLabel,
  inspectAgent,
  nextStepHint,
  statusFromChecks,
  statusRows,
  testAgent,
  type AgentCheck,
  type StatusRow,
} from './agent-status.js';
import { applyBinaryOverrides } from './apply-binary-overrides.js';

// One screen, three sections, so reading, changing and acting are never mixed up:
//
//   STATUS    what was found: read-only, never focusable
//   SETTINGS  the command path and the model: Enter edits, s saves
//   ACTIONS   Run test: Enter runs it (it sends one small prompt, so it costs a few tokens)

type Field = 'binary' | 'model';
type Focus = Field | 'test';
const FOCUS_ORDER: readonly Focus[] = ['binary', 'model', 'test'];
const FIELDS: readonly Field[] = ['binary', 'model'];
const FIELD_LABEL: Record<Field, string> = { binary: 'Command path', model: 'Model' };
const LABEL_WIDTH = 'Command path'.length;

const TONE_COLOR: Record<StatusRow['tone'], string> = {
  ok: PALETTE.success,
  bad: PALETTE.error,
  muted: PALETTE.muted,
};

const fieldHint = (name: AgentName, field: Field): string =>
  field === 'binary' ? `(empty: \`${AGENT_HINTS[name]}\` from the PATH)` : `(empty: ${defaultModelLabel(name)})`;

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={PALETTE.muted}>
        {title}
      </Text>
      {children}
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
}: {
  name: AgentName;
  config: AgentConfig;
  setConfig: (config: AgentConfig) => void;
  onBack: () => void;
}): React.ReactElement {
  const settings = config.agents[name];
  const [focusIndex, setFocusIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [valueBeforeEdit, setValueBeforeEdit] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [checks, setChecks] = useState<AgentCheck[] | undefined>(undefined);

  // Quick check on open, and again whenever the path changes, so the user sees what the path they typed would do.
  useEffect(() => {
    let active = true;
    setChecks(undefined);
    void inspectAgent(name, settings.binary).then((result) => active && setChecks(result));
    return () => {
      active = false;
    };
  }, [name, settings.binary]);

  const setField = (field: Field, value: string): void => {
    setConfig({ ...config, agents: { ...config.agents, [name]: { ...settings, [field]: value } } });
    setNotice(null);
  };

  const save = (): void => {
    setSaving(true);
    setNotice(null);
    writeAgentConfig(config)
      .then(() => {
        applyBinaryOverrides(config);
        setNotice({ kind: 'success', text: `${AGENT_LABELS[name]} settings saved` });
      })
      .catch((err: unknown) =>
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to save' }),
      )
      .finally(() => setSaving(false));
  };

  const runTest = (): void => {
    setTesting(true);
    setNotice(null);
    setChecks(undefined);
    testAgent(name, settings.binary, settings.model)
      .then(setChecks)
      .catch((err: unknown) =>
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'The test could not run' }),
      )
      .finally(() => setTesting(false));
  };

  const focused = FOCUS_ORDER[focusIndex]!;
  const focusedField = focused === 'test' ? null : focused;

  useInput((input, key) => {
    if (saving || testing) return;

    if (editing) {
      // <TextInput> handles typing, the cursor, left/right and Enter (onSubmit) itself.
      if (key.escape && focusedField) {
        setField(focusedField, valueBeforeEdit);
        setEditing(false);
      }
      return;
    }

    if (key.escape || input === 'q') {
      onBack();
      return;
    }
    if (input === 's') {
      save();
      return;
    }
    if (key.upArrow) {
      setFocusIndex((i) => (i - 1 + FOCUS_ORDER.length) % FOCUS_ORDER.length);
      return;
    }
    if (key.downArrow || key.tab) {
      setFocusIndex((i) => (i + 1) % FOCUS_ORDER.length);
      return;
    }
    if (input === 'c' && focusedField) {
      setField(focusedField, '');
      return;
    }
    if (key.return) {
      if (focusedField) {
        setValueBeforeEdit(settings[focusedField]);
        setEditing(true);
      } else {
        runTest();
      }
    }
  });

  const status = checks ? statusFromChecks(name, checks, settings.binary) : 'checking';
  const hint = nextStepHint(name, status);
  const pointer = (isFocused: boolean): React.ReactElement => (
    <Text color={isFocused ? PALETTE.accent : undefined}>{isFocused ? '❯' : ' '}</Text>
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>{AGENT_LABELS[name]}</Text>
      <Text color={PALETTE.muted}>
        {config.defaultAgent === name ? 'This is the default agent.' : `Runs the \`${AGENT_HINTS[name]}\` command.`}
      </Text>

      <Section title="STATUS">
        {statusRows(name, checks, settings.binary).map((row) => (
          <Box key={row.label} gap={1} paddingLeft={2}>
            <Box width={LABEL_WIDTH} flexShrink={0}>
              <Text color={PALETTE.muted}>{row.label}</Text>
            </Box>
            <Text color={TONE_COLOR[row.tone]}>{row.value}</Text>
          </Box>
        ))}
        {hint && (
          <Box paddingLeft={2}>
            <Text color={PALETTE.muted}>Next: {hint}</Text>
          </Box>
        )}
      </Section>

      <Section title="SETTINGS">
        {FIELDS.map((field) => {
          const isFocused = focused === field;
          const value = settings[field];
          return (
            <Box key={field} gap={1}>
              {pointer(isFocused)}
              <Box width={LABEL_WIDTH} flexShrink={0}>
                <Text bold={isFocused} color={isFocused ? PALETTE.accent : PALETTE.muted}>
                  {FIELD_LABEL[field]}
                </Text>
              </Box>
              {isFocused && editing ? (
                <TextInput
                  value={value}
                  onChange={(next) => setField(field, next)}
                  onSubmit={() => setEditing(false)}
                />
              ) : (
                <Text bold>{value}</Text>
              )}
              {!value && <Text color={PALETTE.muted}>{fieldHint(name, field)}</Text>}
            </Box>
          );
        })}
      </Section>

      <Section title="ACTIONS">
        <Box gap={1}>
          {pointer(focused === 'test')}
          <Box width={LABEL_WIDTH} flexShrink={0}>
            <Text bold={focused === 'test'} color={focused === 'test' ? PALETTE.accent : PALETTE.muted}>
              Run test
            </Text>
          </Box>
          <Text color={testing ? PALETTE.accent : PALETTE.muted}>
            {testing ? 'running...' : 'sends one small prompt (uses a few tokens)'}
          </Text>
        </Box>
      </Section>

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
          editing
            ? [
                { keys: 'type', label: 'edit' },
                { keys: '←/→', label: 'move cursor' },
                { keys: '⏎', label: 'done' },
                { keys: 'Esc', label: 'cancel edit' },
              ]
            : [
                { keys: '↑/↓', label: 'move' },
                { keys: '⏎', label: focusedField ? 'edit' : 'run test' },
                ...(focusedField ? [{ keys: 'c', label: 'clear' }] : []),
                { keys: 's', label: 'save' },
                { keys: 'Esc/q', label: 'back without saving' },
              ]
        }
      />
    </Box>
  );
}

import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { PALETTE } from '../../theme.js';
import { ControlHints } from '../../control-hints.js';
import type { FormNotice } from '../shared/FieldForm.js';
import { AGENT_HINTS, AGENT_LABELS, writeAgentConfig, type AgentConfig } from './agent-store.js';
import {
  defaultModelLabel,
  inspectAgent,
  setupHint,
  statusFromChecks,
  statusRows,
  testAgent,
  testOutcome,
  type AgentCheck,
} from './agent-status.js';
import { TONE_COLOR } from './AgentStatusBadge.js';
import { applyBinaryOverrides } from './apply-binary-overrides.js';

// One screen, two sections, with what can be changed on top and what was found underneath, so the two are never mixed up:
//
//   CONFIGURE  the command path and the model (Enter edits, s saves) and Run test (Enter runs it; it sends one small
//              prompt, so it costs a few tokens). The only part with a cursor.
//   STATUS     what was found: read-only, never focusable

type Field = 'binary' | 'model';
type Focus = Field | 'test';
const FOCUS_ORDER: readonly Focus[] = ['binary', 'model', 'test'];
const FIELDS: readonly Field[] = ['binary', 'model'];
const FIELD_LABEL: Record<Field, string> = { binary: 'Command path', model: 'Model' };
const LABEL_WIDTH = 'Command path'.length;
const LABEL_GAP = 2;
const POINTER_WIDTH = 2;

const fieldHint = (name: AgentName, field: Field): string =>
  field === 'binary' ? `(empty: \`${AGENT_HINTS[name]}\` from the PATH)` : `(empty: ${defaultModelLabel(name)})`;

/**
 * One label and value on the screen's shared grid: a pointer slot, the label column, then the value. Both sections use it,
 * so every value starts in the same column. `pointer` is empty for the read-only rows, which keeps their slot.
 */
function Row({
  pointer,
  label,
  labelProps,
  children,
}: {
  pointer: React.ReactNode;
  label: string;
  labelProps?: { bold?: boolean; color?: string };
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box>
      <Box width={POINTER_WIDTH} flexShrink={0}>
        {pointer}
      </Box>
      <Box width={LABEL_WIDTH + LABEL_GAP} flexShrink={0}>
        <Text color={PALETTE.muted} {...labelProps}>
          {label}
        </Text>
      </Box>
      {children}
    </Box>
  );
}

/** A titled block. `note` says what kind it is, and `interactive` colors the title so the editable part stands out. */
function Section({
  title,
  note,
  interactive = false,
  children,
}: {
  title: string;
  note: string;
  interactive?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1}>
        <Text bold color={interactive ? PALETTE.accent : PALETTE.muted}>
          {title}
        </Text>
        <Text color={PALETTE.muted}>{`· ${note}`}</Text>
      </Box>
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
        setNotice({ kind: 'success', text: `Saved: ${AGENT_LABELS[name]} settings are written to config.json` });
      })
      .catch((err: unknown) =>
        setNotice({ kind: 'error', text: `Not saved: ${err instanceof Error ? err.message : String(err)}` }),
      )
      .finally(() => setSaving(false));
  };

  const runTest = (): void => {
    setTesting(true);
    setNotice(null);
    testAgent(name, settings.binary, settings.model)
      .then((result) => {
        setChecks(result);
        const outcome = testOutcome(result);
        // A test that stopped at the path or version check never reached the prompt, so say what blocked it.
        setNotice(
          outcome
            ? { kind: outcome.ok ? 'success' : 'error', text: outcome.text }
            : { kind: 'error', text: 'Test not run: the agent could not be started (see Status)' },
        );
      })
      .catch((err: unknown) =>
        setNotice({ kind: 'error', text: `Test could not run: ${err instanceof Error ? err.message : String(err)}` }),
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
  const hint = setupHint(name, status);
  const pointer = (isFocused: boolean): React.ReactElement => (
    <Text color={isFocused ? PALETTE.accent : undefined}>{isFocused ? '❯' : ' '}</Text>
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>{AGENT_LABELS[name]}</Text>
      <Text color={PALETTE.muted}>
        {config.defaultAgent === name ? 'This is the default agent.' : `Runs the \`${AGENT_HINTS[name]}\` command.`}
      </Text>

      {(notice || testing || saving) && (
        <Box marginTop={1}>
          {testing || saving ? (
            <Text color={PALETTE.accent}>{testing ? '… Running the test (up to 60s)' : '… Saving'}</Text>
          ) : (
            notice && (
              <Text bold color={notice.kind === 'success' ? PALETTE.success : PALETTE.error}>
                {notice.kind === 'success' ? '✓' : '✗'} {notice.text}
              </Text>
            )
          )}
        </Box>
      )}

      <Section title="CONFIGURE" note="you can change these" interactive>
        {FIELDS.map((field) => {
          const isFocused = focused === field;
          const value = settings[field];
          // An empty field shows its hint in the value's place, not after an empty value, so it stays on the grid.
          const display =
            isFocused && editing ? (
              <TextInput value={value} onChange={(next) => setField(field, next)} onSubmit={() => setEditing(false)} />
            ) : value ? (
              <Text bold>{value}</Text>
            ) : (
              <Text color={PALETTE.muted}>{fieldHint(name, field)}</Text>
            );
          return (
            <Row
              key={field}
              pointer={pointer(isFocused)}
              label={FIELD_LABEL[field]}
              labelProps={{ bold: isFocused, color: isFocused ? PALETTE.accent : PALETTE.muted }}
            >
              {display}
            </Row>
          );
        })}
        <Row
          pointer={pointer(focused === 'test')}
          label="Run test"
          labelProps={{ bold: focused === 'test', color: focused === 'test' ? PALETTE.accent : PALETTE.muted }}
        >
          <Text color={testing ? PALETTE.accent : PALETTE.muted}>
            {testing ? 'running...' : 'sends one small prompt (uses a few tokens)'}
          </Text>
        </Row>
      </Section>

      <Section title="STATUS" note="read only">
        {statusRows(name, checks, settings.binary).map((row) => (
          <Row key={row.label} pointer={null} label={row.label}>
            <Text color={TONE_COLOR[row.tone]}>{row.value}</Text>
          </Row>
        ))}
        {hint && (
          <Row pointer={null} label="Setup">
            <Text color={PALETTE.muted}>{hint}</Text>
          </Row>
        )}
      </Section>

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

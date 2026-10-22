import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { SetupForm, type SetupField, type SetupMenuItem } from '@tui/shared/components/SetupForm.js';
import type { ImportTarget } from '../00-preflight/logic.js';
import { resolveUserPath } from '../../resolve-user-path.js';
import { scanFiles } from './helpers/scan-files.js';
import { describeFailure } from './scan-logic.js';
import { describeScan, fieldsFor, trimmed, type InputField, type InputValues } from './logic.js';
import { validateTokenPath } from './validate-path.js';

interface InputsResult {
  projectPath?: string;
  tokensPath?: string;
  scannedFiles?: string[];
}

interface InputsScreenProps {
  target: ImportTarget;
  /** What an earlier visit or the saved settings already hold. */
  initial?: Partial<InputValues>;
  onConfirm: (result: InputsResult) => void;
  onBack: () => void;
}

type Choice = 'continue' | 'edit' | 'back';

const MENU: readonly SetupMenuItem<Choice>[] = [
  { choice: 'continue', label: 'Continue', description: 'Use these and go on' },
  { choice: 'edit', label: 'Edit', description: 'Change the paths' },
  { choice: 'back', label: 'Back', description: 'Go back' },
];

const LABELS: Record<InputField, string> = { projectPath: 'Component library', tokensPath: 'Token file' };

const TITLES: Record<ImportTarget, { title: string; subtitle: string }> = {
  both: {
    title: 'Where are your components and tokens?',
    subtitle: 'The folder with your components and your raw token file. You can use ~, relative, or absolute paths.',
  },
  components: {
    title: 'Where are your components?',
    subtitle: 'The folder with your components. You can use ~, relative, or absolute paths.',
  },
  tokens: {
    title: 'Where is your token file?',
    subtitle:
      'Your raw token file (e.g. ~/design-tokens/tokens.json). Claude will map it to Design Token Group Format (DTCG).',
  },
};

type Check =
  | { state: 'empty' }
  | { state: 'ok'; detail: string; warning?: string }
  | { state: 'error'; lines: string[] };

function checkProject(value: string, hasTokens: boolean): { check: Check; filePaths: string[] } {
  const path = trimmed(value);
  if (path === null) return { check: { state: 'empty' }, filePaths: [] };
  const resolved = resolveUserPath(path);
  const scan = scanFiles(resolved);
  if (!scan.ok) {
    const { headline, hints } = describeFailure(scan.failure, resolved);
    return { check: { state: 'error', lines: [headline, ...hints] }, filePaths: [] };
  }
  const { line, warning } = describeScan(scan.counts, hasTokens);
  return { check: { state: 'ok', detail: line, ...(warning ? { warning } : {}) }, filePaths: scan.filePaths };
}

function checkTokens(value: string): { check: Check; path: string } {
  const path = trimmed(value);
  if (path === null) return { check: { state: 'empty' }, path: '' };
  const result = validateTokenPath(path);
  if (!result.ok) return { check: { state: 'error', lines: [result.error] }, path: '' };
  return { check: { state: 'ok', detail: result.path }, path: result.path };
}

function Note({ check }: { check: Check }): React.ReactElement {
  if (check.state === 'empty') return <Text color={PALETTE.muted}>Enter a path to check it.</Text>;
  if (check.state === 'error') {
    return (
      <Box flexDirection="column">
        {check.lines.map((line, index) => (
          <Text key={line} color={index === 0 ? PALETTE.error : PALETTE.muted}>
            {index === 0 ? '✗ ' : '  '}
            {line}
          </Text>
        ))}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color={PALETTE.success}>✓ {check.detail}</Text>
      {check.warning && <Text color={PALETTE.warning}>⚠ {check.warning}</Text>}
    </Box>
  );
}

export function InputsScreen({ target, initial = {}, onConfirm, onBack }: InputsScreenProps): React.ReactElement {
  const keys = fieldsFor(target);
  const hasTokens = target !== 'components';
  const [values, setValues] = useState<InputValues>({
    projectPath: initial.projectPath ?? '',
    tokensPath: initial.tokensPath ?? '',
  });
  const [saved, setSaved] = useState(values);
  // The checks read the saved values, so they run when the screen opens and when an edit is finished, not per keystroke.
  const project = useMemo(
    () => (keys.includes('projectPath') ? checkProject(saved.projectPath, hasTokens) : undefined),
    [saved.projectPath, keys.join(), hasTokens],
  );
  const tokens = useMemo(
    () => (keys.includes('tokensPath') ? checkTokens(saved.tokensPath) : undefined),
    [saved.tokensPath, keys.join()],
  );
  const [notice, setNotice] = useState<string | null>(null);

  const fields: readonly SetupField<InputField>[] = keys.map((key) => ({
    key,
    label: LABELS[key],
    note: <Note check={(key === 'projectPath' ? project : tokens)!.check} />,
  }));

  return (
    <SetupForm
      {...TITLES[target]}
      menu={MENU}
      dataTitle="Your files"
      fields={fields}
      values={values}
      initialEditing={keys.every((key) => trimmed(saved[key]) === null)}
      onChange={(key, value) => {
        setValues((current) => ({ ...current, [key]: value }));
        setNotice(null);
      }}
      onCommit={() => setSaved(values)}
      onCancel={() => {
        setValues(saved);
        setNotice(null);
      }}
      onChoose={(choice) => {
        if (choice === 'back') {
          onBack();
          return;
        }
        const projectOk = project === undefined || project.check.state === 'ok';
        const tokensOk = tokens === undefined || tokens.check.state === 'ok';
        if (!projectOk || !tokensOk) {
          setNotice('Fix the paths above first. Choose Edit to change them.');
          return;
        }
        onConfirm({
          ...(project
            ? { projectPath: resolveUserPath(saved.projectPath.trim()), scannedFiles: project.filePaths }
            : {}),
          ...(tokens ? { tokensPath: tokens.path } : {}),
        });
      }}
      onEscape={onBack}
    >
      {notice && (
        <Box marginTop={1}>
          <Text color={PALETTE.error}>✗ {notice}</Text>
        </Box>
      )}
    </SetupForm>
  );
}

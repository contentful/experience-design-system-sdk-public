import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { resolveUserPath } from '../../resolve-user-path.js';
import { scanFiles } from './helpers/scan-files.js';
import { describeFailure, phaseOf, summarize, type PathPhase, type ScanResult, type SummaryRow } from './logic.js';
import { MenuScreen, type MenuItem } from '@tui/shared/components/MenuScreen.js';

interface PathValidationScreenProps {
  projectPath: string;
  onConfirm: (result: { projectPath: string; filePaths: string[] }) => void;
  onChangePath: () => void;
  onBack: () => void;
  /** False when the import does not generate tokens, so `.json` files are not described as design tokens. */
  hasTokens?: boolean;
}

type Choice = 'continue' | 'change-path' | 'back';

const BACK: MenuItem<Choice> = { choice: 'back', label: 'Back', description: 'Go back' };

const MENUS: Record<PathPhase, readonly MenuItem<Choice>[]> = {
  scanning: [BACK],
  ready: [{ choice: 'continue', label: 'Continue', description: 'Use these files and go on' }, BACK],
  failed: [{ choice: 'change-path', label: 'Try a different path', description: 'Pick a different folder' }, BACK],
};

function Row({ row }: { row: SummaryRow }): React.ReactElement {
  return (
    <Text color={row.tone === 'accent' ? PALETTE.accent : row.tone === 'muted' ? PALETTE.muted : undefined}>
      {'  • '}
      {String(row.count).padStart(3)} {row.label}
    </Text>
  );
}

function Failure({ scan, path }: { scan: Extract<ScanResult, { ok: false }>; path: string }): React.ReactElement {
  const { headline, hints } = describeFailure(scan.failure, path);
  return (
    <Box flexDirection="column">
      <Text color={PALETTE.error}>✗ {headline}</Text>
      {hints.map((hint) => (
        <Text key={hint} color={PALETTE.muted}>
          {hint}
        </Text>
      ))}
    </Box>
  );
}

function Summary({
  scan,
  path,
  hasTokens,
}: {
  scan: Extract<ScanResult, { ok: true }>;
  path: string;
  hasTokens: boolean;
}): React.ReactElement {
  const { total, rows, warning } = summarize(scan.counts, { hasTokens });
  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        Scanned <Text bold>{path}</Text>
      </Text>
      <Box flexDirection="column">
        <Text color={PALETTE.success}>✓ Found {total} files:</Text>
        {rows.map((row) => (
          <Row key={row.label} row={row} />
        ))}
      </Box>
      {warning && <Text color={PALETTE.warning}>⚠ {warning}</Text>}
    </Box>
  );
}

export function PathValidationScreen({
  projectPath,
  onConfirm,
  onChangePath,
  onBack,
  hasTokens = true,
}: PathValidationScreenProps): React.ReactElement {
  const resolvedPath = useMemo(() => resolveUserPath(projectPath), [projectPath]);
  const [scan, setScan] = useState<ScanResult>();

  useEffect(() => {
    setScan(scanFiles(resolvedPath));
  }, [resolvedPath]);

  const phase = phaseOf(scan);

  const choose = (choice: Choice): void => {
    if (choice === 'continue') {
      if (scan?.ok) onConfirm({ projectPath: resolvedPath, filePaths: scan.filePaths });
    } else if (choice === 'change-path') onChangePath();
    else onBack();
  };

  return (
    // keyed by phase: the menu changes length, so its focus starts over
    <MenuScreen key={phase} title="Scan" menu={MENUS[phase]} onChoose={choose} onEscape={onBack}>
      <Text> </Text>
      {scan === undefined && (
        <Text color={PALETTE.muted}>
          Scanning <Text bold>{resolvedPath}</Text>...
        </Text>
      )}
      {scan?.ok === false && <Failure scan={scan} path={resolvedPath} />}
      {scan?.ok === true && <Summary scan={scan} path={resolvedPath} hasTokens={hasTokens} />}
    </MenuScreen>
  );
}

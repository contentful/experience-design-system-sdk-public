import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { startDebugRun, finishDebugRun } from '@tui/debug-store.js';
import { resolveUserPath } from '../../resolve-user-path.js';
import type { ImportTarget } from '../00-preflight/logic.js';
import { controlsFor, usePathValidationControls } from './controls.js';
import { scanFiles } from './helpers/scan-files.js';
import { describeFailure, phaseOf, scanReport, summarize, type ScanResult, type SummaryRow } from './logic.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { StepHeader } from '@tui/shared/components/StepHeader.js';

interface PathValidationScreenProps {
  /** What the user chose to import at Preflight; it decides which steps run, so every log notes it. */
  mode: ImportTarget;
  projectPath: string;
  onConfirm: (result: { projectPath: string; filePaths: string[] }) => void;
  onChangePath: () => void;
  onBack: () => void;
  /** False when the import does not generate tokens, so `.json` files are not described as design tokens. */
  hasTokens?: boolean;
}

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
      <Text>Does this look right?</Text>
    </Box>
  );
}

export function PathValidationScreen({
  mode,
  projectPath,
  onConfirm,
  onChangePath,
  onBack,
  hasTokens = true,
}: PathValidationScreenProps): React.ReactElement {
  const resolvedPath = useMemo(() => resolveUserPath(projectPath), [projectPath]);
  const [scan, setScan] = useState<ScanResult>();

  useEffect(() => {
    startDebugRun({
      flow: 'import/path-validation',
      step: '03-path-validation',
      menuOption: 'Path validation',
      inputs: { import_mode: mode, project_path: projectPath, resolved_path: resolvedPath },
    });
  }, []);

  useEffect(() => {
    setScan(scanFiles(resolvedPath));
  }, [resolvedPath]);

  const phase = phaseOf(scan);

  // A scan that failed is a failed step, whatever the user does next; the log says what they did about it.
  const finish = (outcome: 'continued' | 'changed-path' | 'back', exitMethod: 'saved' | 'discarded') => {
    void finishDebugRun({
      outputs: { outcome, ...scanReport(scan, resolvedPath, { hasTokens }) },
      status: scan?.ok === false ? 'error' : 'success',
      exitMethod,
    });
  };

  usePathValidationControls(phase, {
    onConfirm: () => {
      if (!scan?.ok) return;
      finish('continued', 'saved');
      onConfirm({ projectPath: resolvedPath, filePaths: scan.filePaths });
    },
    onChangePath: () => {
      finish('changed-path', 'discarded');
      onChangePath();
    },
    onBack: () => {
      finish('back', 'discarded');
      onBack();
    },
  });

  return (
    <Box flexDirection="column">
      <StepHeader step="setup" />
      <Box flexDirection="column" gap={1} paddingX={2} paddingBottom={1}>
        {scan === undefined && (
          <Text color={PALETTE.muted}>
            Scanning <Text bold>{resolvedPath}</Text>...
          </Text>
        )}
        {scan?.ok === false && <Failure scan={scan} path={resolvedPath} />}
        {scan?.ok === true && <Summary scan={scan} path={resolvedPath} hasTokens={hasTokens} />}

        <Box marginTop={1}>
          <ControlHints hints={controlsFor(phase)} />
        </Box>
      </Box>
    </Box>
  );
}

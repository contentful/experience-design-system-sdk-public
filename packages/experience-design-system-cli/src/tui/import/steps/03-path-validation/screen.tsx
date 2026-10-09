import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../home/home.theme.js';
import { resolveUserPath } from '../../resolve-user-path.js';
import { controlsFor, usePathValidationControls } from './controls.js';
import { scanFiles } from './helpers/scan-files.js';
import { describeFailure, phaseOf, summarize, type ScanResult, type SummaryRow } from './logic.js';

interface PathValidationScreenProps {
  projectPath: string;
  onConfirm: (result: { projectPath: string; filePaths: string[] }) => void;
  onChangePath: () => void;
  onBack: () => void;
}

function Row({ row }: { row: SummaryRow }): React.ReactElement {
  return (
    <Text color={row.tone === 'accent' ? PALETTE.accent : undefined} dimColor={row.tone === 'muted'}>
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
        <Text key={hint} dimColor>
          {hint}
        </Text>
      ))}
    </Box>
  );
}

function Summary({ scan, path }: { scan: Extract<ScanResult, { ok: true }>; path: string }): React.ReactElement {
  const { total, rows, warning } = summarize(scan.counts);
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
  projectPath,
  onConfirm,
  onChangePath,
  onBack,
}: PathValidationScreenProps): React.ReactElement {
  const resolvedPath = useMemo(() => resolveUserPath(projectPath), [projectPath]);
  const [scan, setScan] = useState<ScanResult>();

  useEffect(() => {
    setScan(scanFiles(resolvedPath));
  }, [resolvedPath]);

  const phase = phaseOf(scan);

  usePathValidationControls(phase, {
    onConfirm: () => {
      if (scan?.ok) onConfirm({ projectPath: resolvedPath, filePaths: scan.filePaths });
    },
    onChangePath,
    onBack,
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {scan === undefined && (
        <Text dimColor>
          Scanning <Text bold>{resolvedPath}</Text>...
        </Text>
      )}
      {scan?.ok === false && <Failure scan={scan} path={resolvedPath} />}
      {scan?.ok === true && <Summary scan={scan} path={resolvedPath} />}

      <Box marginTop={1} gap={3}>
        {controlsFor(phase).map((control) => (
          <Text key={control.keys} dimColor>
            [{control.keys}] {control.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

import React from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  ServerPreviewResponse,
  ApplyOperationResponse,
  ApplyOperationItem,
} from '@contentful/experience-design-system-types';
import { ServerPreviewView } from './ServerPreviewView.js';

interface ServerPreviewConfirmProps {
  preview: ServerPreviewResponse;
  spaceId: string;
  environmentId: string;
  breakingWithImpact: boolean;
  onConfirm: (acknowledge: boolean) => void;
  onCancel: () => void;
}

export function ServerPreviewConfirm({
  preview,
  spaceId,
  environmentId,
  breakingWithImpact,
  onConfirm,
  onCancel,
}: ServerPreviewConfirmProps): React.ReactElement {
  useInput((input, key) => {
    if (key.return) onConfirm(breakingWithImpact);
    if (key.escape || input === 'q') onCancel();
  });

  return (
    <Box flexDirection="column">
      <ServerPreviewView preview={preview} spaceId={spaceId} environmentId={environmentId} />
      <Box paddingX={2} flexDirection="column">
        {breakingWithImpact && (
          <Text color="red" bold>
            {' '}
            ⚠ Breaking changes will affect downstream entities. Press Enter to acknowledge and apply.
          </Text>
        )}
        <Text>
          {' '}
          Press <Text bold>Enter</Text> to apply, <Text bold>Esc</Text> to cancel
        </Text>
      </Box>
    </Box>
  );
}

interface ServerPreviewAppProps {
  preview: ServerPreviewResponse;
  spaceId: string;
  environmentId: string;
}

export function ServerPreviewApp({ preview, spaceId, environmentId }: ServerPreviewAppProps): React.ReactElement {
  useInput((input, key) => {
    if (key.escape || input === 'q') process.exit(0);
  });

  return <ServerPreviewView preview={preview} spaceId={spaceId} environmentId={environmentId} />;
}

interface ServerApplyProgressProps {
  spaceId: string;
  environmentId: string;
  status: 'applying' | 'polling' | 'error';
  operationId?: string;
  error?: string;
}

export function ServerApplyProgress({
  spaceId,
  environmentId,
  status,
  operationId,
  error,
}: ServerApplyProgressProps): React.ReactElement {
  useInput((_input, key) => {
    if (status === 'error' && (key.escape || _input === 'q')) process.exit(1);
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>
        Import — {environmentId} @ {spaceId}
      </Text>
      <Text> </Text>
      {status === 'applying' && <Text> Submitting apply request...</Text>}
      {status === 'polling' && <Text> Operation {operationId} in progress...</Text>}
      {status === 'error' && (
        <Box flexDirection="column">
          <Text color="red"> ✗ Error: {error}</Text>
          <Text> </Text>
          <Text dimColor> Press Q to exit.</Text>
        </Box>
      )}
    </Box>
  );
}

interface ServerApplyDoneProps {
  operation: ApplyOperationResponse;
  spaceId: string;
  environmentId: string;
}

export function ServerApplyDone({ operation, spaceId, environmentId }: ServerApplyDoneProps): React.ReactElement {
  useInput((input, key) => {
    if (key.escape || input === 'q') {
      process.exit(operation.sys.status === 'succeeded' ? 0 : 1);
    }
  });

  const failures = (operation.items ?? []).filter((item) => item.status === 'failed');

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>
        Import complete — {environmentId} @ {spaceId}
      </Text>
      <Text> </Text>
      <Text color="green"> ✓ {operation.summary.succeeded} succeeded</Text>
      {operation.summary.failed > 0 && <Text color="red"> ✗ {operation.summary.failed} failed</Text>}
      {operation.summary.failed === 0 && <Text dimColor> All entities imported successfully.</Text>}
      {failures.length > 0 && (
        <Box flexDirection="column">
          <Text> </Text>
          <Text bold> Failures:</Text>
          {failures.map((item, i) => (
            <Box key={i} flexDirection="column">
              <Text color="red">
                {' '}
                ✗ {item.entityType}: {item.id}
              </Text>
              {item.error && <Text dimColor> {formatItemError(item.error)}</Text>}
            </Box>
          ))}
        </Box>
      )}
      <Text> </Text>
      <Text dimColor> Press Q to exit.</Text>
    </Box>
  );
}

function formatItemError(error: ApplyOperationItem['error']): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return `${error.code}: ${error.message}`;
}

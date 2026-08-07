import React from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  ServerPreviewResponse,
  ApplyOperationResponse,
  ApplyOperationItem,
} from '@contentful/experience-design-system-types';
import { ServerPreviewView } from './ServerPreviewView.js';
import { buildPostPushUrl } from '../../lib/contentful-urls.js';
import { formatEdsiError } from '../../lib/error-parser.js';

interface ServerPreviewConfirmProps {
  preview: ServerPreviewResponse;
  spaceId: string;
  environmentId: string;
  breakingWithImpact: boolean;
  allowDeletions: boolean;
  onConfirm: (acknowledge: boolean) => void;
  onCancel: () => void;
}

export function ServerPreviewConfirm({
  preview,
  spaceId,
  environmentId,
  breakingWithImpact,
  allowDeletions,
  onConfirm,
  onCancel,
}: ServerPreviewConfirmProps): React.ReactElement {
  useInput((input, key) => {
    if (key.return) onConfirm(breakingWithImpact);
    if (key.escape || input === 'q') onCancel();
  });

  const removedCount = preview.components.removed.length + preview.tokens.removed.length;

  return (
    <Box flexDirection="column">
      <ServerPreviewView
        preview={preview}
        spaceId={spaceId}
        environmentId={environmentId}
        allowDeletions={allowDeletions}
      />
      <Box paddingX={2} flexDirection="column">
        {breakingWithImpact && (
          <Text color="red" bold>
            {' '}
            ⚠ Breaking changes will affect downstream entities. Press Enter to acknowledge and apply.
          </Text>
        )}
        {allowDeletions && removedCount > 0 && (
          <Text color="red" bold>
            {' '}
            ⚠ {removedCount} missing {removedCount === 1 ? 'entity' : 'entities'} will be permanently deleted. Press
            Enter to confirm.
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
  allowDeletions: boolean;
}

export function ServerPreviewApp({
  preview,
  spaceId,
  environmentId,
  allowDeletions,
}: ServerPreviewAppProps): React.ReactElement {
  useInput((input, key) => {
    if (key.escape || input === 'q') process.exit(0);
  });

  return (
    <ServerPreviewView
      preview={preview}
      spaceId={spaceId}
      environmentId={environmentId}
      allowDeletions={allowDeletions}
    />
  );
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
  /** Configured API host (e.g. `api.contentful.com`). Used to derive the post-push webapp URL. */
  host?: string;
}

export function ServerApplyDone({ operation, spaceId, environmentId, host }: ServerApplyDoneProps): React.ReactElement {
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
      {operation.sys.status === 'succeeded' && operation.summary.succeeded > 0 && (
        <Box flexDirection="column">
          <Text> </Text>
          <Text dimColor> View your design system:</Text>
          <Text color="cyan"> {buildPostPushUrl({ host: host ?? 'api.contentful.com', spaceId, environmentId })}</Text>
        </Box>
      )}
      <Text> </Text>
      <Text dimColor> Press Q to exit.</Text>
    </Box>
  );
}

function formatItemError(error: ApplyOperationItem['error']): string {
  return formatEdsiError(error);
}

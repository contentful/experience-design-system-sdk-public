import React from 'react';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

type EntityResult = {
  created: number;
  updated: number;
  removed: number;
  failed: number;
};

type DoneStepProps = {
  componentTypes: EntityResult;
  designTokens: EntityResult;
  summary?: { total: number; succeeded: number; failed: number };
  spaceId: string;
  environmentId: string;
  /** Task 8 — pre-formatted run teaser; rendered dim below the space link. */
  runTeaser?: string;
  onExit: () => void;
};

export function DoneStep({
  componentTypes,
  designTokens,
  summary,
  spaceId,
  environmentId,
  runTeaser,
  onExit,
}: DoneStepProps): React.ReactElement {
  useImmediateInput((input, key) => {
    if (key.return || input === 'q' || key.escape) {
      onExit();
    }
  });

  const totalFailed = componentTypes.failed + designTokens.failed;
  const totalPushed =
    componentTypes.created +
    componentTypes.updated +
    componentTypes.removed +
    designTokens.created +
    designTokens.updated +
    designTokens.removed;
  const success = totalFailed === 0;

  function EntityRows({ entity, label }: { entity: EntityResult; label: string }) {
    return (
      <>
        {entity.created > 0 && (
          <Box gap={1}>
            <Text color="green">✓</Text>
            <Text>
              {entity.created} {label}
              {entity.created !== 1 ? 's' : ''} created
            </Text>
          </Box>
        )}
        {entity.updated > 0 && (
          <Box gap={1}>
            <Text color="green">✓</Text>
            <Text>
              {entity.updated} {label}
              {entity.updated !== 1 ? 's' : ''} updated
            </Text>
          </Box>
        )}
        {entity.removed > 0 && (
          <Box gap={1}>
            <Text color="green">✓</Text>
            <Text>
              {entity.removed} {label}
              {entity.removed !== 1 ? 's' : ''} removed
            </Text>
          </Box>
        )}
        {entity.failed > 0 && (
          <Box gap={1}>
            <Text color="red">✗</Text>
            <Text color="red">
              {entity.failed} {label}
              {entity.failed !== 1 ? 's' : ''} failed — check logs above
            </Text>
          </Box>
        )}
      </>
    );
  }

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {success ? (
        <Text bold color="green">
          Done!
        </Text>
      ) : (
        <Text bold color="yellow">
          ⚠ Finished with errors
        </Text>
      )}

      {totalPushed === 0 && totalFailed === 0 && !summary ? (
        <Box marginTop={1}>
          <Text dimColor>Nothing was pushed — everything was already up to date.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" gap={0} marginTop={1}>
          <EntityRows entity={componentTypes} label="Component Type" />
          <EntityRows entity={designTokens} label="Design Token" />
          {summary && (
            <Box gap={1} marginTop={1}>
              <Text dimColor>
                Server: {summary.succeeded}/{summary.total} succeeded
              </Text>
              {summary.failed > 0 && <Text color="red">, {summary.failed} failed</Text>}
            </Box>
          )}
        </Box>
      )}

      <Box gap={1} marginTop={1}>
        <Text dimColor>Space:</Text>
        <Text>{spaceId}</Text>
        <Text dimColor>/</Text>
        <Text dimColor>Environment:</Text>
        <Text>{environmentId}</Text>
      </Box>

      {success && totalPushed > 0 && (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text dimColor>Your design system is now in Contentful ExO.</Text>
          <Box flexDirection="column" gap={0}>
            <Text dimColor>View it here:</Text>
            <Text color="cyan">{`https://app.contentful.com/spaces/${spaceId}/environments/${environmentId}/views/components`}</Text>
          </Box>
        </Box>
      )}

      {runTeaser && (
        <Box marginTop={1}>
          <Text dimColor>{runTeaser}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>[Enter / q] Exit</Text>
      </Box>
    </Box>
  );
}

import React from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import { buildPostPushUrl } from '../../../lib/contentful-urls.js';
import { SpaceEnvironment } from '../components/SpaceEnvironment.js';

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
  host?: string;
  runTeaser?: string;
  failures?: Array<{ entityType: string; entityId: string; message: string }>;
  onExit: () => void;
};

const ACTIONS = ['created', 'updated', 'removed'] as const;

function EntityRows({ entity, label }: { entity: EntityResult; label: string }): React.ReactElement {
  const plural = (n: number) => `${n} ${label}${n !== 1 ? 's' : ''}`;
  return (
    <>
      {ACTIONS.filter((action) => entity[action] > 0).map((action) => (
        <Text key={action}>
          <Text color={PALETTE.success}>✓</Text> {plural(entity[action])} {action}
        </Text>
      ))}
      {entity.failed > 0 && (
        <Text color={PALETTE.error}>✗ {plural(entity.failed)} failed — check logs above</Text>
      )}
    </>
  );
}

function LinkRow({ title, url }: { title: string; url: string }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text dimColor>{title}</Text>
      <Text color={PALETTE.link}>{url}</Text>
    </Box>
  );
}

export function DoneStep({
  componentTypes,
  designTokens,
  summary,
  spaceId,
  environmentId,
  host,
  failures = [],
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
  const urlArgs = { host: host ?? 'api.contentful.com', spaceId, environmentId };

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      {success ? (
        <Text bold color={PALETTE.success}>
          Done!
        </Text>
      ) : (
        <Text bold color={PALETTE.warning}>
          ⚠ Finished with errors
        </Text>
      )}

      {totalPushed === 0 && totalFailed === 0 && !summary ? (
        <Text dimColor>Nothing was pushed — everything was already up to date.</Text>
      ) : (
        <Box flexDirection="column">
          <EntityRows entity={componentTypes} label="Component Type" />
          <EntityRows entity={designTokens} label="Design Token" />
          {summary && (
            <Box marginTop={1}>
              <Text dimColor>
                Push result: {summary.succeeded}/{summary.total} succeeded
                {summary.failed > 0 && <Text color={PALETTE.error}>, {summary.failed} failed</Text>}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {failures.length > 0 && (
        <Box flexDirection="column">
          <Text bold color={PALETTE.error}>
            Failure details
          </Text>
          {failures.map((failure) => (
            <Text key={`${failure.entityType}:${failure.entityId}`} color={PALETTE.error}>
              {failure.entityType} {failure.entityId}: {failure.message}
            </Text>
          ))}
        </Box>
      )}

      <SpaceEnvironment spaceId={spaceId} environmentId={environmentId} />

      {success && totalPushed > 0 && (
        <Box flexDirection="column" gap={1}>
          <Text color={PALETTE.success}>Your design system is now in Contentful Experiences.</Text>
          <LinkRow title="View your components here:" url={buildPostPushUrl(urlArgs)} />
          <LinkRow title="View your design tokens here:" url={buildPostPushUrl({ ...urlArgs, view: 'design_tokens' })} />
        </Box>
      )}

      <Text dimColor>[Enter / q] Exit</Text>
    </Box>
  );
}

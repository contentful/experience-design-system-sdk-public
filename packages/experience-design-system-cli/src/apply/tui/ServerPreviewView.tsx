import React from 'react';
import { Box, Text } from 'ink';
import type {
  ServerPreviewResponse,
  ChangedEntity,
  ComponentTypeSummary,
  CDFComponentEntry,
} from '@contentful/experience-design-system-types';

interface ServerPreviewViewProps {
  preview: ServerPreviewResponse;
  spaceId: string;
  environmentId: string;
}

function BreakingBadge({ item }: { item: ChangedEntity<ComponentTypeSummary, CDFComponentEntry> }) {
  if (!item.changeClassification || item.changeClassification.classification !== 'breaking') return null;
  const reasons = item.changeClassification.breakingChanges
    .map((bc) => `${'slotId' in bc ? bc.slotId : bc.propertyId}: ${bc.reason}`)
    .join(', ');
  return (
    <Box flexDirection="column">
      <Text color="red"> ⚠ BREAKING: {reasons}</Text>
      {item.impact && (item.impact.affectedFragments > 0 || item.impact.affectedExperiences > 0) && (
        <Text color="red">
          {' '}
          → affects {item.impact.affectedFragments} Fragments, {item.impact.affectedExperiences} Experiences
        </Text>
      )}
    </Box>
  );
}

function DraftWarning({ hasDraft }: { hasDraft: boolean }) {
  if (!hasDraft) return null;
  return <Text color="yellow"> ⚡ has pending draft changes</Text>;
}

export function ServerPreviewView({ preview, spaceId, environmentId }: ServerPreviewViewProps): React.ReactElement {
  const { components, tokens } = preview;
  const totalComponents =
    components.new.length + components.changed.length + components.unchanged.length + components.removed.length;
  const totalTokens = tokens.new.length + tokens.changed.length + tokens.unchanged.length + tokens.removed.length;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>
        Preview — {environmentId} @ {spaceId}
      </Text>
      <Text> </Text>

      {totalComponents > 0 && (
        <Box flexDirection="column">
          <Text bold> Component Types ({totalComponents} total)</Text>
          <Text color="green"> ❆ {components.new.length} to create</Text>
          <Text color="yellow"> ~ {components.changed.length} to update</Text>
          <Text color="red"> ✗ {components.removed.length} to remove</Text>
          <Text dimColor> · {components.unchanged.length} unchanged</Text>
          {components.changed.map((item, i) => (
            <Box key={i} flexDirection="column">
              <Box flexDirection="row">
                <Text color="yellow"> ~ {item.current.name}</Text>
                <DraftWarning hasDraft={item.hasPendingDraftChanges} />
              </Box>
              <BreakingBadge item={item} />
            </Box>
          ))}
          <Text> </Text>
        </Box>
      )}

      {totalTokens > 0 && (
        <Box flexDirection="column">
          <Text bold> Design Tokens ({totalTokens} total)</Text>
          <Text color="green"> ❆ {tokens.new.length} to create</Text>
          <Text color="yellow"> ~ {tokens.changed.length} to update</Text>
          <Text color="red"> ✗ {tokens.removed.length} to remove</Text>
          <Text dimColor> · {tokens.unchanged.length} unchanged</Text>
          {tokens.changed
            .filter((t) => t.hasPendingDraftChanges)
            .map((item, i) => (
              <Box key={i} flexDirection="row">
                <Text color="yellow"> ~ {item.current.name}</Text>
                <DraftWarning hasDraft={true} />
              </Box>
            ))}
          <Text> </Text>
        </Box>
      )}

      <Text dimColor> Press Q to exit.</Text>
    </Box>
  );
}

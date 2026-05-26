import React from 'react';
import { Box, Text } from 'ink';

export interface SelectableEntity {
  id: string;
  kind: 'token' | 'component';
  status: 'new' | 'changed';
  isBreaking?: boolean;
}

export function makeSelectKey(kind: 'token' | 'component', id: string): string {
  return `${kind}:${id}`;
}

interface SelectViewProps {
  entities: SelectableEntity[];
  spaceId: string;
  environmentId: string;
  selectedIndex: number;
  selected: Set<string>;
  importing: boolean;
}

const STATUS_ICON: Record<string, string> = {
  new: '✦',
  changed: '~',
};

const STATUS_COLOR: Record<string, string> = {
  new: 'green',
  changed: 'yellow',
};

export function SelectView({
  entities,
  spaceId,
  environmentId,
  selectedIndex,
  selected,
  importing,
}: SelectViewProps): React.ReactElement {
  const tokens = entities.filter((e) => e.kind === 'token');
  const components = entities.filter((e) => e.kind === 'component');

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      <Text bold>
        Select — {environmentId} @ {spaceId}
      </Text>
      <Text> </Text>

      {tokens.length > 0 && (
        <Box flexDirection="column">
          <Text bold> Design Tokens</Text>
          {tokens.map((entity, i) => {
            const key = makeSelectKey('token', entity.id);
            return renderRow(entity, i, selectedIndex, selected.has(key), importing);
          })}
          <Text> </Text>
        </Box>
      )}

      {components.length > 0 && (
        <Box flexDirection="column">
          <Text bold> Component Types</Text>
          {components.map((entity, i) => {
            const globalIdx = tokens.length + i;
            const key = makeSelectKey('component', entity.id);
            return renderRow(entity, globalIdx, selectedIndex, selected.has(key), importing);
          })}
          <Text> </Text>
        </Box>
      )}

      {entities.length === 0 && <Text dimColor> No entities to display.</Text>}

      {importing ? (
        <Text dimColor> Applying selected entities...</Text>
      ) : (
        <Box flexDirection="column">
          <Text dimColor> {selected.size} selected</Text>
          <Text dimColor> ↑↓ navigate Space toggle A all N none I apply selected Q quit</Text>
        </Box>
      )}
    </Box>
  );
}

function renderRow(
  entity: SelectableEntity,
  globalIdx: number,
  selectedIndex: number,
  checked: boolean,
  importing: boolean,
): React.ReactElement {
  const isCursor = globalIdx === selectedIndex;
  const icon = STATUS_ICON[entity.status] ?? '?';
  const color = STATUS_COLOR[entity.status] ?? 'white';
  const checkbox = checked ? '[✓]' : '[ ]';
  const cursor = isCursor ? '>' : ' ';
  const breakingNote = entity.isBreaking ? ' ⚠ breaking' : '';

  return (
    <Box key={entity.id} flexDirection="row">
      <Text color={isCursor ? 'cyan' : undefined}>{cursor} </Text>
      <Text color={checked ? 'cyan' : 'gray'}>{checkbox} </Text>
      <Text color={color}>{icon} </Text>
      <Box flexGrow={1} marginRight={1}>
        <Text color={isCursor ? 'cyan' : undefined} wrap="wrap">
          {entity.id}
        </Text>
      </Box>
      <Text color={color}>
        {entity.status}
        {breakingNote}
      </Text>
      {importing && checked && isCursor && <Text dimColor> (writing...)</Text>}
    </Box>
  );
}

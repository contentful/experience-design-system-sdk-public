import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '../../theme.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { AgentsScreen } from './agents/AgentsScreen.js';
import { ProjectScreen } from './project/ProjectScreen.js';

type Section = 'project' | 'agents';

const SECTIONS: readonly { id: Section; label: string; description: string }[] = [
  {
    id: 'project',
    label: 'Project',
    description: 'Contentful space, credentials, defaults and where .contentful goes',
  },
  { id: 'agents', label: 'Agents', description: 'Which coding agent the CLI uses, and each agent’s settings' },
];

/** Settings > Configuration: a short menu that opens the Project settings or the Agent settings. */
export function ConfigurationScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [focus, setFocus] = useState(0);
  const [open, setOpen] = useState<Section | null>(null);
  const close = (): void => setOpen(null);

  useInput((input, key) => {
    if (open) return;
    if (key.upArrow) {
      setFocus((i) => (i - 1 + SECTIONS.length) % SECTIONS.length);
      return;
    }
    if (key.downArrow || key.tab) {
      setFocus((i) => (i + 1) % SECTIONS.length);
      return;
    }
    if (key.return) {
      setOpen(SECTIONS[focus]!.id);
      return;
    }
    if (key.escape || input === 'q') onDone();
  });

  if (open === 'project') return <ProjectScreen onDone={close} />;
  if (open === 'agents') return <AgentsScreen onDone={close} />;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Configuration</Text>
      <Text> </Text>
      {SECTIONS.map((section, index) => (
        <Box key={section.id} gap={1}>
          <Text color={index === focus ? PALETTE.accent : undefined}>{index === focus ? '❯' : ' '}</Text>
          <Box width={9} flexShrink={0}>
            <Text bold={index === focus} color={index === focus ? PALETTE.accent : undefined}>
              {section.label}
            </Text>
          </Box>
          <Text color={PALETTE.muted}>{section.description}</Text>
        </Box>
      ))}
      <Text> </Text>
      <ControlHints
        hints={[
          { keys: '↑/↓', label: 'move' },
          { keys: '⏎', label: 'open' },
          { keys: 'Esc/q', label: 'back' },
        ]}
      />
    </Box>
  );
}

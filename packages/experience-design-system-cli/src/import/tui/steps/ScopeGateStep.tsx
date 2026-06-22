import { Box, Text } from 'ink';
import React, { useState } from 'react';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

export type ScopeComponent = { name: string; componentId: string };

export type ScopeGateStepProps = {
  components: ScopeComponent[];
  onConfirm: (decisions: { accepted: string[]; rejected: string[] }) => void;
  onQuit: () => void;
};

export function ScopeGateStep({
  components,
  onConfirm,
  onQuit,
}: ScopeGateStepProps): React.ReactElement {
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(components.map((c) => c.name)),
  );
  const [cursor, setCursor] = useState(0);

  const partition = (): { accepted: string[]; rejected: string[] } => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const c of components) {
      if (included.has(c.name)) accepted.push(c.name);
      else rejected.push(c.name);
    }
    return { accepted, rejected };
  };

  useImmediateInput((input, key) => {
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }
    if (key.return) {
      onConfirm(partition());
      return;
    }
    if (input === 'a') {
      setIncluded(new Set(components.map((c) => c.name)));
      return;
    }
    if (input === 'n') {
      setIncluded(new Set());
      return;
    }
    if (input === ' ') {
      const name = components[cursor]?.name;
      if (!name) return;
      setIncluded((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(components.length - 1, c + 1));
      return;
    }
  });

  const includedCount = included.size;
  const total = components.length;

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text color="green">✓ Extraction complete</Text>
      <Text dimColor>
        Found {total} component{total === 1 ? '' : 's'}. Pick which ones to import. Generation runs only on the
        included set.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {components.map((c, i) => {
          const isCursor = i === cursor;
          const isIn = included.has(c.name);
          const marker = isIn ? '[✓]' : '[ ]';
          const prefix = isCursor ? '›' : ' ';
          return (
            <Text key={c.componentId} color={isCursor ? 'cyan' : undefined}>
              {prefix} {marker} {c.name}
            </Text>
          );
        })}
      </Box>

      <Box gap={3} marginTop={1}>
        <Text dimColor>
          {includedCount}/{total} included
        </Text>
        <Text dimColor>[j/k] move</Text>
        <Text dimColor>[Space] toggle</Text>
        <Text dimColor>[a] all</Text>
        <Text dimColor>[n] none</Text>
        <Text dimColor>[Enter] confirm</Text>
        <Text dimColor>[q] quit</Text>
      </Box>
    </Box>
  );
}

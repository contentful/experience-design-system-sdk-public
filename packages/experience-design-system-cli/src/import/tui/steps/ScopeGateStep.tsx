import { Box, Text } from 'ink';
import React, { useState } from 'react';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

export type ScopeComponent = {
  name: string;
  componentId: string;
  aiDecision?: 'accepted' | 'rejected' | null;
  aiReason?: string | null;
};

export type ScopeGateStepProps = {
  components: ScopeComponent[];
  onConfirm: (decisions: { accepted: string[]; rejected: string[] }) => void;
  onQuit: () => void;
  // Feature 3: auto-filter overlay state. Optional so existing callers (and
  // tests) without auto-filter still work unchanged.
  aiFilterStatus?: 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';
  aiFilterProgress?: { done: number; total: number } | null;
  aiFilterError?: string | null;
  onCancelAutoFilter?: () => void;
};

const VISIBLE_COUNT = 10;

export function ScopeGateStep({
  components,
  onConfirm,
  onQuit,
}: ScopeGateStepProps): React.ReactElement {
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(components.map((c) => c.name)),
  );
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

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
    if (input === 'f' || input === 'F') {
      onConfirm(partition());
      return;
    }
    if (input === 'a') {
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
    if (input === 'A') {
      // If every component is currently included, clear all; otherwise include all.
      const allIncluded = components.every((c) => included.has(c.name));
      if (allIncluded) setIncluded(new Set());
      else setIncluded(new Set(components.map((c) => c.name)));
      return;
    }
    if (input === 'r') {
      const name = components[cursor]?.name;
      if (!name) return;
      setIncluded((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => {
        const next = Math.max(0, c - 1);
        setScrollOffset((prev) => Math.min(prev, next));
        return next;
      });
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => {
        const next = Math.min(components.length - 1, c + 1);
        setScrollOffset((prev) => (next >= prev + VISIBLE_COUNT ? next - VISIBLE_COUNT + 1 : prev));
        return next;
      });
      return;
    }
  });

  const includedCount = included.size;
  const total = components.length;

  const visibleEnd = Math.min(scrollOffset + VISIBLE_COUNT, total);
  const visible = components.slice(scrollOffset, visibleEnd);
  const above = scrollOffset;
  const below = Math.max(0, total - visibleEnd);

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text color="green">✓ Extraction complete</Text>
      <Text dimColor>
        Found {total} component{total === 1 ? '' : 's'}. Pick which ones to import. Generation runs only on the
        included set.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {above > 0 && <Text dimColor>↑ {above} above</Text>}
        {visible.map((c, vi) => {
          const i = vi + scrollOffset;
          const isCursor = i === cursor;
          const isIn = included.has(c.name);
          const marker = isIn ? '[✓]' : '[ ]';
          const prefix = isCursor ? '›' : ' ';
          if (isCursor) {
            return (
              <Text key={c.componentId} color="cyan">
                {prefix} {marker} {c.name}
              </Text>
            );
          }
          if (!isIn) {
            return (
              <Text key={c.componentId} dimColor>
                {prefix} {marker} {c.name}
              </Text>
            );
          }
          return (
            <Text key={c.componentId}>
              {prefix} <Text color="green">{marker}</Text> {c.name}
            </Text>
          );
        })}
        {below > 0 && <Text dimColor>↓ {below} below</Text>}
      </Box>

      <Box gap={3} marginTop={1}>
        {includedCount > 0 ? (
          <Text>
            <Text color="green">{includedCount}</Text>
            <Text dimColor>
              /{total} included
            </Text>
          </Text>
        ) : (
          <Text color="yellow">none included</Text>
        )}
        <Text>
          <Text color="cyan">[j/k]</Text> <Text dimColor>move</Text>
        </Text>
        <Text>
          <Text color="cyan">[a]</Text> <Text dimColor>toggle</Text>
        </Text>
        <Text>
          <Text color="cyan">[A]</Text> <Text dimColor>toggle all</Text>
        </Text>
        <Text>
          <Text color="cyan">[r]</Text> <Text dimColor>reject</Text>
        </Text>
        <Text>
          <Text color="cyan">[f]</Text> <Text dimColor>continue</Text>
        </Text>
        <Text>
          <Text color="cyan">[q]</Text> <Text dimColor>quit</Text>
        </Text>
      </Box>
    </Box>
  );
}

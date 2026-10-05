import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { SelectionReviewItem } from '@contentful/experience-design-system-agents';
import { PALETTE } from '../home/home.theme.js';

export interface SelectionReviewScreenProps {
  items: SelectionReviewItem[];
  onDone: () => void;
}

function formatAgentValues(valuesByAgent: Record<number, unknown>): string {
  return Object.entries(valuesByAgent)
    .map(([agent, value]) => 'agent ' + agent + ': ' + JSON.stringify(value))
    .join(' · ');
}

function formatEvidence(evidence: Array<{ source: string; line: string; quote: string }>): string {
  return evidence.map(({ source, line, quote }) => `${source}:${line} — ${quote}`).join(' · ');
}

export function SelectionReviewScreen({ items, onDone }: SelectionReviewScreenProps): React.ReactElement {
  useInput((input, key) => {
    if (key.return || key.escape || input === 'q') onDone();
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Selection Review</Text>
      <Text> </Text>
      {items.length === 0 ? (
        <Text color={PALETTE.muted}>No disagreement outcomes are available.</Text>
      ) : (
        items.map((item) => (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
            <Text bold color={item.status === 'resolved' ? PALETTE.success : PALETTE.warning}>
              {item.id} · {item.componentKey} · {item.status}
            </Text>
            <Text>
              tier: {item.tier} · field: {item.field} · values: {formatAgentValues(item.valuesByAgent)}
            </Text>
            {item.debate?.for && <Text>FOR: {item.debate.for.argument}</Text>}
            {item.debate?.for && item.debate.for.evidence && item.debate.for.evidence.length > 0 && (
              <Text dimColor>FOR evidence: {formatEvidence(item.debate.for.evidence)}</Text>
            )}
            {item.debate?.against && <Text>AGAINST: {item.debate.against.argument}</Text>}
            {item.debate?.against && item.debate.against.evidence && item.debate.against.evidence.length > 0 && (
              <Text dimColor>AGAINST evidence: {formatEvidence(item.debate.against.evidence)}</Text>
            )}
            {item.determination && (
              <Text color={PALETTE.success}>
                outcome: {item.determination.decision} via {item.determination.resolvedBy} — {item.determination.reason}
              </Text>
            )}
          </Box>
        ))
      )}
      <Text dimColor>[Enter/Esc/q] Back to Start</Text>
    </Box>
  );
}

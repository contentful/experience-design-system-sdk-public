import React from 'react';
import { Text } from 'ink';
import type { AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { PALETTE } from '../../theme.js';
import { LIST_STATUS, statusFromChecks, type AgentCheck, type StatusRow } from './agent-status.js';

export const TONE_COLOR: Record<StatusRow['tone'], string> = {
  ok: PALETTE.success,
  bad: PALETTE.error,
  muted: PALETTE.muted,
};

/** The symbol and one-word state for an agent, shown on its row in the list. `binary` is the saved path, empty when none is saved. */
export function AgentStatusBadge({
  name,
  checks,
  binary,
}: {
  name: AgentName;
  checks: AgentCheck[] | undefined;
  binary: string;
}): React.ReactElement {
  const { symbol, text, tone } = LIST_STATUS[checks ? statusFromChecks(name, checks, binary) : 'checking'];
  return <Text color={TONE_COLOR[tone]}>{`${symbol} ${text}`}</Text>;
}

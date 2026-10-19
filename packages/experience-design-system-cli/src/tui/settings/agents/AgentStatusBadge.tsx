import React from 'react';
import { Text } from 'ink';
import type { AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { PALETTE } from '../../home/home.theme.js';
import { statusFromChecks, type AgentCheck, type AgentStatus } from './agent-status.js';

const STATUS_TEXT: Record<AgentStatus, string> = {
  checking: 'checking...',
  ready: 'ready',
  'not-configured': 'not configured',
  'not-found': 'not found',
  'not-logged-in': 'not logged in',
  unknown: 'found, login not checked',
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  checking: PALETTE.muted,
  ready: PALETTE.success,
  'not-configured': PALETTE.muted,
  'not-found': PALETTE.error,
  'not-logged-in': PALETTE.error,
  unknown: PALETTE.muted,
};

/** The one-word state for an agent, shown on its row in the list. `binary` is the saved path, empty when none is saved. */
export function AgentStatusBadge({
  name,
  checks,
  binary,
}: {
  name: AgentName;
  checks: AgentCheck[] | undefined;
  binary: string;
}): React.ReactElement {
  const status = checks ? statusFromChecks(name, checks, binary) : 'checking';
  return <Text color={STATUS_COLOR[status]}>{STATUS_TEXT[status]}</Text>;
}

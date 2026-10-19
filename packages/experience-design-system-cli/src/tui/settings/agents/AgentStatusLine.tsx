import React from 'react';
import { Box, Text } from 'ink';
import type { AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { PALETTE } from '../../home/home.theme.js';
import { nextStepHint, statusFromChecks, type AgentCheck, type AgentStatus } from './agent-status.js';

const STATUS_TEXT: Record<AgentStatus, string> = {
  checking: 'checking...',
  ready: 'ready',
  'not-found': 'not found',
  'not-logged-in': 'not logged in',
  unknown: 'found, login not checked',
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  checking: PALETTE.muted,
  ready: PALETTE.success,
  'not-found': PALETTE.error,
  'not-logged-in': PALETTE.error,
  unknown: PALETTE.muted,
};

/** The one-word state for an agent, shown on its row in the list. */
export function AgentStatusBadge({
  name,
  checks,
}: {
  name: AgentName;
  checks: AgentCheck[] | undefined;
}): React.ReactElement {
  const status = checks ? statusFromChecks(name, checks) : 'checking';
  return <Text color={STATUS_COLOR[status]}>{STATUS_TEXT[status]}</Text>;
}

/** Every check that ran, one per line, and what to do next when the agent is not ready. */
export function AgentChecks({
  name,
  checks,
}: {
  name: AgentName;
  checks: AgentCheck[] | undefined;
}): React.ReactElement {
  if (!checks) {
    return (
      <Box marginTop={1}>
        <Text color={PALETTE.muted}>Checking...</Text>
      </Box>
    );
  }
  const status = statusFromChecks(name, checks);
  const hint = nextStepHint(name, status);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        Status: <Text color={STATUS_COLOR[status]}>{STATUS_TEXT[status]}</Text>
      </Text>
      {checks.map((check) => (
        <Text key={check.step} color={check.ok ? PALETTE.success : PALETTE.muted}>
          {check.ok ? '✓' : '·'} {check.step}: {check.detail}
        </Text>
      ))}
      {hint && <Text color={PALETTE.muted}>Next: {hint}</Text>}
    </Box>
  );
}

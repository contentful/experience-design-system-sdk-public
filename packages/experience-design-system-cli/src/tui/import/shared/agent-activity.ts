import type { AgentInvocationActivity } from '@contentful/experience-design-system-backend-pipeline';

export function describeAgentActivity(activity?: AgentInvocationActivity): string | undefined {
  if (!activity) return undefined;
  const attempt = `attempt ${activity.attempt} of ${activity.maxAttempts}`;
  const subject = activity.component ? `${activity.component} · ` : '';
  switch (activity.phase) {
    case 'preparing':
      return `${subject}Preparing task context and validation evidence · ${attempt}`;
    case 'running':
      return `${subject}${activity.resumed ? 'Continuing the same agent conversation' : 'Agent invocation in progress'} · ${attempt}`;
    case 'validating':
      return `${subject}Host is validating the returned response · ${attempt}`;
    case 'retrying':
      return `${subject}Preparing a repair after ${attempt}${activity.resumed ? ' · conversation retained' : ''}`;
  }
}

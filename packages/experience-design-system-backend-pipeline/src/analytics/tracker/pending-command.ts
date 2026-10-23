import { IMPORT_PIPELINE_ENV } from '../constants.js';
import { normalizeCommand } from '../normalize.js';
import type { CommandCompletion, CommandContext, DsiCliCommand } from '../types.js';

export type PendingCommand = {
  command: DsiCliCommand;
  startedAt: number;
  invoked: boolean;
  terminalEmitted: boolean;
  context: CommandContext;
  completion: CommandCompletion;
};

// Module-level mutable state shared across every file in the tracker/ folder. Node modules are
// singletons, so this is the single source of truth for one CLI invocation.
export const state: {
  pending: PendingCommand | null;
  sessionId: string | undefined;
  sessionStartedEmitted: boolean;
} = {
  pending: null,
  sessionId: undefined,
  sessionStartedEmitted: false,
};

export function isPipelineStep(): boolean {
  return process.env[IMPORT_PIPELINE_ENV] === '1';
}

export function buildBaseProps(command: DsiCliCommand): Record<string, unknown> {
  return {
    dsi_session_id: state.sessionId,
    command,
    ...(isPipelineStep() ? { is_pipeline_step: true } : {}),
  };
}

export function mergeContext(target: CommandContext, source: CommandContext): void {
  if (source.space_key !== undefined) target.space_key = source.space_key;
  if (source.environment_key !== undefined) target.environment_key = source.environment_key;
  if (source.x_contentful_request_id !== undefined) {
    target.x_contentful_request_id = source.x_contentful_request_id;
  }
}

/** Record the start of a tracked command. Invoked is deferred until a session is bound. */
export function noteCommandStart(commandChain: string): void {
  const command = normalizeCommand(commandChain);
  if (!command) return;

  state.pending = {
    command,
    startedAt: Date.now(),
    invoked: false,
    terminalEmitted: false,
    context: {},
    completion: {},
  };
}

/** Attach Contentful target context for the active command. */
export function setCommandContext(context: CommandContext): void {
  if (!state.pending) return;
  mergeContext(state.pending.context, context);
  mergeContext(state.pending.completion, context);
}

/** Merge optional completion fields before the terminal event fires. */
export function enrichCommandResult(fields: CommandCompletion): void {
  if (!state.pending) return;
  Object.assign(state.pending.completion, fields);
  mergeContext(state.pending.context, fields);
}

export function resetAnalyticsStateForTests(): void {
  state.pending = null;
  state.sessionId = undefined;
  state.sessionStartedEmitted = false;
}

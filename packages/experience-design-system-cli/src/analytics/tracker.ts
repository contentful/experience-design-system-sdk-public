import { cliVersion, trackEvent } from './client.js';
import { IMPORT_PIPELINE_ENV } from './constants.js';
import { normalizeCommand } from './normalize.js';
import { getOsName } from './os.js';
import { resolveAnalyticsSessionId } from './session.js';
import type { CommandCompletion, CommandContext, CommandFailure, DsiCliCommand, EntryCommand } from './types.js';

type PendingCommand = {
  command: DsiCliCommand;
  startedAt: number;
  invoked: boolean;
  terminalEmitted: boolean;
  context: CommandContext;
  completion: CommandCompletion;
};

let pending: PendingCommand | null = null;
let sessionId: string | undefined;
let sessionStartedEmitted = false;

function isPipelineStep(): boolean {
  return process.env[IMPORT_PIPELINE_ENV] === '1';
}

function buildBaseProps(command: DsiCliCommand): Record<string, unknown> {
  return {
    dsi_session_id: sessionId,
    command,
    ...(isPipelineStep() ? { is_pipeline_step: true } : {}),
  };
}

function mergeContext(target: CommandContext, source: CommandContext): void {
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

  pending = {
    command,
    startedAt: Date.now(),
    invoked: false,
    terminalEmitted: false,
    context: {},
    completion: {},
  };
}

/** Bind a session id, preferring a pipeline parent id when present. */
export async function bindAnalyticsSessionId(sessionId: string | undefined, context?: CommandContext): Promise<string> {
  const id = resolveAnalyticsSessionId(sessionId);
  await bindAnalyticsSession(id, context);
  return id;
}

/** Attach Contentful target context for the active command. */
export function setCommandContext(context: CommandContext): void {
  if (!pending) return;
  mergeContext(pending.context, context);
  mergeContext(pending.completion, context);
}

/** Merge optional completion fields before the terminal event fires. */
export function enrichCommandResult(fields: CommandCompletion): void {
  if (!pending) return;
  Object.assign(pending.completion, fields);
  mergeContext(pending.context, fields);
}

export function getBoundSessionId(): string | undefined {
  return sessionId;
}

/** Bind the pipeline session and emit invoked once both command and session are known. */
export async function bindAnalyticsSession(id: string, context?: CommandContext): Promise<void> {
  sessionId = id;
  if (context) setCommandContext(context);
  await emitInvokedIfReady();
}

/** Emit session_started once per new pipeline head. */
export async function emitSessionStarted(entryCommand: EntryCommand): Promise<void> {
  if (!sessionId || sessionStartedEmitted) return;
  sessionStartedEmitted = true;

  await trackEvent(
    'dsi_cli_session_started',
    {
      dsi_session_id: sessionId,
      entry_command: entryCommand,
      cli_version: cliVersion(),
      node_version: process.version,
      os_name: getOsName(),
    },
    sessionId,
    { flush: true },
  );
  await emitInvokedIfReady();
}

async function emitInvokedIfReady(): Promise<void> {
  if (!pending || pending.invoked || !sessionId) return;

  pending.invoked = true;
  await trackEvent(
    'dsi_cli_command_invoked',
    {
      ...buildBaseProps(pending.command),
      ...pending.context,
    },
    sessionId,
    { flush: true },
  );
}

export async function completeActiveCommand(): Promise<void> {
  if (!pending || pending.terminalEmitted || !sessionId || !pending.invoked) return;

  pending.terminalEmitted = true;
  const durationMs = Date.now() - pending.startedAt;

  await trackEvent(
    'dsi_cli_command_completed',
    {
      ...buildBaseProps(pending.command),
      ...pending.context,
      ...pending.completion,
      outcome: 'ok',
      duration_ms: durationMs,
    },
    sessionId,
    { flush: true },
  );
}

export async function failActiveCommand(fields: CommandFailure = {}): Promise<void> {
  if (!pending || pending.terminalEmitted || !sessionId || !pending.invoked) return;

  pending.terminalEmitted = true;
  const durationMs = Date.now() - pending.startedAt;
  const outcome = fields.exit_code === 130 ? 'interrupted' : 'error';

  await trackEvent(
    'dsi_cli_command_failed',
    {
      ...buildBaseProps(pending.command),
      ...pending.context,
      ...fields,
      outcome,
      duration_ms: durationMs,
    },
    sessionId,
    { flush: true },
  );
}

export function resetAnalyticsStateForTests(): void {
  pending = null;
  sessionId = undefined;
  sessionStartedEmitted = false;
}

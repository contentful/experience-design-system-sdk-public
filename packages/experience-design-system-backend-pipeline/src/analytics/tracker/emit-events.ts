import { cliVersion } from '../client/cli-info.js';
import { trackEvent } from '../client/segment-client.js';
import { getOsName } from '../os.js';
import { resolveAnalyticsSessionId } from '../session.js';
import type { CommandContext, CommandFailure, EntryCommand } from '../types.js';
import { buildBaseProps, setCommandContext, state } from './pending-command.js';

/** Bind a session id, preferring a pipeline parent id when present. */
export async function bindAnalyticsSessionId(explicit: string | undefined, context?: CommandContext): Promise<string> {
  const id = resolveAnalyticsSessionId(explicit);
  await bindAnalyticsSession(id, context);
  return id;
}

/** Bind the pipeline session and emit invoked once both command and session are known. */
export async function bindAnalyticsSession(id: string, context?: CommandContext): Promise<void> {
  state.sessionId = id;
  if (context) setCommandContext(context);
  await emitInvokedIfReady();
}

/** Emit session_started once per new pipeline head. */
export async function emitSessionStarted(entryCommand: EntryCommand): Promise<void> {
  if (!state.sessionId || state.sessionStartedEmitted) return;
  state.sessionStartedEmitted = true;

  await trackEvent(
    'dsi_cli_session_started',
    {
      dsi_session_id: state.sessionId,
      entry_command: entryCommand,
      cli_version: cliVersion(),
      node_version: process.version,
      os_name: getOsName(),
    },
    state.sessionId,
    { flush: true },
  );
  await emitInvokedIfReady();
}

async function emitInvokedIfReady(): Promise<void> {
  if (!state.pending || state.pending.invoked || !state.sessionId) return;

  state.pending.invoked = true;
  await trackEvent(
    'dsi_cli_command_invoked',
    {
      ...buildBaseProps(state.pending.command),
      ...state.pending.context,
    },
    state.sessionId,
    { flush: true },
  );
}

export async function completeActiveCommand(): Promise<void> {
  if (!state.pending || state.pending.terminalEmitted || !state.sessionId || !state.pending.invoked) return;

  state.pending.terminalEmitted = true;
  const durationMs = Date.now() - state.pending.startedAt;

  await trackEvent(
    'dsi_cli_command_completed',
    {
      ...buildBaseProps(state.pending.command),
      ...state.pending.context,
      ...state.pending.completion,
      outcome: 'ok',
      duration_ms: durationMs,
    },
    state.sessionId,
    { flush: true },
  );
}

export async function failActiveCommand(fields: CommandFailure = {}): Promise<void> {
  if (!state.pending || state.pending.terminalEmitted || !state.sessionId || !state.pending.invoked) return;

  state.pending.terminalEmitted = true;
  const durationMs = Date.now() - state.pending.startedAt;
  const outcome = fields.exit_code === 130 ? 'interrupted' : 'error';

  await trackEvent(
    'dsi_cli_command_failed',
    {
      ...buildBaseProps(state.pending.command),
      ...state.pending.context,
      ...fields,
      outcome,
      duration_ms: durationMs,
    },
    state.sessionId,
    { flush: true },
  );
}

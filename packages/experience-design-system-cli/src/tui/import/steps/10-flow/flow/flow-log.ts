import { scrubError } from '@tui/shared/debug-trail.js';
import type { FlowState, PushResult } from './types.js';

// What the debug log says about each step of the flow after the review. The flow is one state machine, so these functions
// describe a step from the state it started in and the state it ended in; `use-flow-log` calls them as the step changes.
// The CMA token is in the flow state, so every message that comes out of it is scrubbed first.

type FlowStep = FlowState['step'];

const STEPS: Record<FlowStep, { number: string; label: string }> = {
  'final-review': { number: '09', label: 'Final review' },
  previewing: { number: '10', label: 'Previewing' },
  'preview-gate': { number: '10', label: 'Preview gate' },
  pushing: { number: '10', label: 'Pushing' },
  'path-prompt': { number: '10', label: 'Save path' },
  printing: { number: '10', label: 'Writing files' },
  'print-gate': { number: '10', label: 'Files saved' },
  done: { number: '10', label: 'Done' },
  error: { number: '10', label: 'Error' },
  'preview-validation-error': { number: '10', label: 'Preview validation error' },
};

// The order a successful import goes through. Moving to a step later in the list is going forward; anything else (editing
// definitions again, or a failure) is not.
const FORWARD: readonly FlowStep[] = [
  'final-review',
  'previewing',
  'preview-gate',
  'pushing',
  'path-prompt',
  'printing',
  'print-gate',
  'done',
];

// A long list of failures must not make the log grow without bound.
const MAX_LOGGED = 10;

const scrub = (text: string, state: FlowState): string => scrubError(text, [state.cmaToken]);

/** Where a step's log goes and what it is called. */
export function flowStepRun(step: FlowStep): { flow: string; step: string; menuOption: string } {
  const { number, label } = STEPS[step];
  return { flow: `import/${step}`, step: `${number}-${step}`, menuOption: label };
}

function pushSummary(result: PushResult, state: FlowState): Record<string, unknown> {
  const failures = result.failures ?? [];
  return {
    component_types: result.componentTypes,
    design_tokens: result.designTokens,
    ...(result.summary ? { summary: result.summary } : {}),
    ...(failures.length > 0
      ? {
          failure_count: failures.length,
          failures: failures.slice(0, MAX_LOGGED).map((failure) => ({
            entity_type: failure.entityType,
            entity_id: failure.entityId,
            message: scrub(failure.message, state),
          })),
        }
      : {}),
  };
}

/** What a step started with. The token is only ever under `cma_token`, which the logger reduces to "present, N chars". */
export function flowStepInputs(state: FlowState): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    agent: state.agent,
    space_id: state.spaceId,
    environment_id: state.environmentId,
    host: state.host,
    credentials_skipped: state.credentialsSkipped,
    components_generated: state.generatedCount,
    components_accepted: state.generatedAcceptedCount,
    tokens: state.tokenCount,
    cma_token: state.cmaToken,
  };
  switch (state.step) {
    case 'final-review':
      if (state.finalizeErrorBanner) inputs['finalize_error'] = scrub(state.finalizeErrorBanner, state);
      break;
    case 'path-prompt':
      inputs['default_path'] = state.outDir;
      break;
    case 'error':
      inputs['error_step'] = state.errorStep;
      inputs['error'] = scrub(state.errorMessage, state);
      inputs['can_retry_credentials'] = state.errorAllowCredentialRetry;
      inputs['can_acknowledge_breaking_changes'] = state.errorAllowBreakingChangeAcknowledgment;
      break;
    case 'preview-validation-error':
      inputs['validation_error_count'] = state.previewValidationErrors.length;
      inputs['validation_errors'] = state.previewValidationErrors.slice(0, MAX_LOGGED).map((error) => ({
        component: error.componentName,
        path: error.path,
        message: scrub(error.message, state),
      }));
      inputs['missing_names'] = state.previewValidationMissingNames.slice(0, MAX_LOGGED * 2);
      break;
    case 'done':
      Object.assign(inputs, { push_result: pushSummary(state.pushResult, state) });
      break;
    default:
      break;
  }
  return inputs;
}

/**
 * How a step ended. `to` is the state it moved to, or undefined when the import was left while the step was open. A step
 * that ended by moving to the error screen is itself an error, with that screen's step and message, so a failed push or
 * preview names its cause in its own log.
 */
export function flowStepOutputs(
  from: FlowState,
  to: FlowState | undefined,
): { outputs: Record<string, unknown>; status: 'success' | 'error'; exitMethod: 'saved' | 'discarded' } {
  const outputs: Record<string, unknown> = { next_step: to?.step ?? 'exited' };
  let failed = from.step === 'error' || from.step === 'preview-validation-error';

  if (to?.step === 'error') {
    failed = true;
    outputs['error_step'] = to.errorStep;
    outputs['error'] = scrub(to.errorMessage, to);
  }
  if (from.step === 'final-review' && to?.finalizeErrorBanner) {
    outputs['finalize_error'] = scrub(to.finalizeErrorBanner, to);
  }
  if (from.step === 'pushing' && to) {
    outputs['push_result'] = pushSummary(to.pushResult, to);
    if (to.pushResult.componentTypes.failed + to.pushResult.designTokens.failed > 0) failed = true;
  }
  if (from.step === 'path-prompt' && to?.componentsPath) outputs['saved_to'] = to.componentsPath;
  if (from.step === 'printing' && to) {
    outputs['saved_to'] = to.componentsPath;
    outputs['run_id'] = to.lastRunId;
  }

  const forward = to ? FORWARD.indexOf(to.step) > FORWARD.indexOf(from.step) && FORWARD.includes(from.step) : false;
  // Leaving the import on a finished step is a normal exit; leaving it anywhere else, or going back, is not progress.
  const finished = to === undefined && (from.step === 'done' || from.step === 'print-gate');
  return { outputs, status: failed ? 'error' : 'success', exitMethod: forward || finished ? 'saved' : 'discarded' };
}

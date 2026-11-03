import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { scrubError } from '@tui/shared/debug-trail.js';
import type { FlowState, PushResult } from './types.js';

// What the debug log says about the part of the import after the review: saving the files, previewing the change against
// Contentful, pushing it, and how that ended. It is one log for the whole run, built up in memory as the flow moves and
// written when the run ends. `use-flow-log` hands the trail to the logger as it grows, so a crash or Ctrl+C still writes
// what happened so far. The screens that only wait for the user are not logged; the decisions that matter are.
// The CMA token is in the flow state, so every message that comes out of it is scrubbed first.

type FlowStep = FlowState['step'];

/** Where the log goes: one folder for the whole step, numbered so it sorts after the earlier steps. */
export const FLOW_RUN = { flow: 'import/publish', step: '10-publish', menuOption: 'Publish' } as const;

const LABELS: Record<FlowStep, string> = {
  'final-review': 'Final review',
  'path-prompt': 'Save path',
  printing: 'Save files',
  previewing: 'Preview',
  'preview-gate': 'Preview confirmation',
  pushing: 'Push',
  'print-gate': 'Files saved',
  done: 'Done',
  error: 'Error',
  'preview-validation-error': 'Preview validation',
};

// The steps that do work. These are timed and listed; the others only wait for the user.
const WORK: readonly FlowStep[] = ['printing', 'previewing', 'pushing'];

// Going back to the review ends the run too, so the review's log and this one are never open at the same time.
const FINISHED: readonly FlowStep[] = ['done', 'error', 'preview-validation-error', 'final-review'];

// A long list of failures must not make the log grow without bound.
const MAX_LOGGED = 10;

// Cut an error short in the one-line outcome. The whole message is in the error section.
const MAX_OUTCOME = 200;

export type FlowTrail = {
  startedAt: number;
  stageStartedAt: number;
  /** The step the flow is in now. */
  at: FlowStep;
  stages: string[];
  preview?: Record<string, unknown>;
  push?: Record<string, unknown>;
  pushFailed?: boolean;
  saved?: { path: string; run_id: string | null };
  failure?: { step: string; message: string };
  validation?: Record<string, unknown>;
};

const scrub = (text: string, state: FlowState): string => scrubError(text, [state.cmaToken]);

const seconds = (ms: number): number => Math.round(ms / 100) / 10;

const pushHasFailures = (result: PushResult): boolean =>
  result.componentTypes.failed + result.designTokens.failed > 0 ||
  (result.failures?.length ?? 0) > 0 ||
  (result.summary?.failed ?? 0) > 0;

function previewSummary(preview: ServerPreviewResponse): Record<string, unknown> {
  const counts = (group: { new: unknown[]; changed: unknown[]; removed: unknown[] }): Record<string, number> => ({
    new: group.new.length,
    changed: group.changed.length,
    removed: group.removed.length,
  });
  return {
    components: counts(preview.components),
    tokens: counts(preview.tokens),
    breaking_components: preview.components.changed.filter(
      (entry) => entry.changeClassification?.classification === 'breaking',
    ).length,
  };
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

/** What the run starts with, stated once. The token is only ever under `cma_token`, which the logger reduces to "present, N chars". */
export function flowContext(state: FlowState): Record<string, unknown> {
  return {
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
}

// What the flow found out by arriving in a step. Only the error screens carry anything.
function arrive(trail: FlowTrail, state: FlowState): FlowTrail {
  const next = { ...trail, at: state.step };
  if (state.step === 'error') {
    next.failure = { step: state.errorStep, message: scrub(state.errorMessage, state) };
  }
  if (state.step === 'preview-validation-error') {
    next.validation = {
      count: state.previewValidationErrors.length,
      errors: state.previewValidationErrors.slice(0, MAX_LOGGED).map((error) => ({
        component: error.componentName,
        path: error.path,
        message: scrub(error.message, state),
      })),
      missing_names: state.previewValidationMissingNames.slice(0, MAX_LOGGED * 2),
    };
  }
  return next;
}

/** Starts the trail at the state the run began in. */
export function openTrail(state: FlowState, now: number): FlowTrail {
  return arrive({ startedAt: now, stageStartedAt: now, at: state.step, stages: [] }, state);
}

/** Adds what happened when the flow moved from one step to the next. */
export function advance(trail: FlowTrail, from: FlowState, to: FlowState, now: number): FlowTrail {
  const next: FlowTrail = { ...trail, stages: [...trail.stages], stageStartedAt: now };
  const failed =
    to.step === 'error' ||
    to.step === 'preview-validation-error' ||
    (from.step === 'pushing' && pushHasFailures(to.pushResult));

  if (WORK.includes(from.step)) {
    next.stages.push(`${LABELS[from.step]}: ${failed ? 'failed' : 'ok'} (${seconds(now - trail.stageStartedAt)}s)`);
  }
  if (from.step === 'previewing' && to.serverPreview) next.preview = previewSummary(to.serverPreview);
  if (from.step === 'pushing') {
    next.push = pushSummary(to.pushResult, to);
    next.pushFailed = pushHasFailures(to.pushResult);
  }
  if (from.step === 'printing' && !failed) next.saved = { path: to.componentsPath, run_id: to.lastRunId };
  return arrive(next, to);
}

export const isFlowFinished = (step: FlowStep): boolean => FINISHED.includes(step);

function render(trail: FlowTrail, now: number, outcome: string): Record<string, unknown> {
  return {
    outcome,
    total_seconds: seconds(now - trail.startedAt),
    stages: trail.stages,
    ...(trail.preview ? { preview: trail.preview } : {}),
    ...(trail.push ? { push: trail.push } : {}),
    ...(trail.saved ? { saved: trail.saved } : {}),
    ...(trail.failure ? { error: trail.failure } : {}),
    ...(trail.validation ? { preview_validation: trail.validation } : {}),
  };
}

/** What a crash or Ctrl+C writes if it cuts the run short. */
export function flowProgress(trail: FlowTrail, now: number): Record<string, unknown> {
  return render(trail, now, `interrupted at ${LABELS[trail.at]}`);
}

/**
 * How the run ended. `final` is the state it ended in, or undefined when the import was left while the run was open. The
 * outcome names the cause, so a failed push or preview says why in the first line of its own log.
 */
export function flowFinish(
  trail: FlowTrail,
  final: FlowState | undefined,
  now: number,
): { outputs: Record<string, unknown>; status: 'success' | 'error'; exitMethod: 'saved' | 'discarded' } {
  if (!final) {
    const midWork = WORK.includes(trail.at);
    const outcome = `left the import ${midWork ? 'while' : 'at'} ${LABELS[trail.at]}${midWork ? ' was running' : ''}`;
    return { outputs: render(trail, now, outcome), status: midWork ? 'error' : 'success', exitMethod: 'discarded' };
  }

  if (final.step === 'final-review') {
    return {
      outputs: render(trail, now, 'went back to edit the definitions'),
      status: 'success',
      exitMethod: 'discarded',
    };
  }

  let outcome: string;
  let failed = true;
  if (trail.validation) {
    outcome = `blocked by ${String(trail.validation['count'])} preview validation error(s)`;
  } else if (trail.failure) {
    outcome = `failed at ${trail.failure.step}: ${trail.failure.message.slice(0, MAX_OUTCOME)}`;
  } else if (trail.pushFailed) {
    outcome = 'pushed, but some entities failed';
  } else {
    failed = false;
    outcome = final.credentialsSkipped ? 'saved without pushing (credentials skipped)' : 'published';
  }
  return {
    outputs: render(trail, now, outcome),
    status: failed ? 'error' : 'success',
    exitMethod: failed ? 'discarded' : 'saved',
  };
}

import type { AgentName } from '@contentful/experience-design-system-backend-pipeline';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { AGENT_LABELS } from '@tui/settings/configuration/agents/agent-store.js';
import { scrubError } from '@tui/shared/debug-trail.js';
import { nameLines, nameList } from '../../../shared/entity-lists.js';
import { noteJourney } from '../../../shared/import-ledger.js';
import type { FlowState, PushResult } from './types.js';

// What the debug log says about the part of the import after the review: saving the files, previewing the change against
// Contentful, pushing it, and how that ended. It is one log for the whole run, built up in memory as the flow moves and
// written when the run ends. `use-flow-log` hands the trail to the logger as it grows, so a crash or Ctrl+C still writes
// what happened so far. The screens that only wait for the user are not logged; the decisions that matter are.
// The CMA token is in the flow state, so every message that comes out of it is scrubbed first. The credentials themselves
// are in the Credentials log and are not repeated here.

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

type ChangeCounts = { new: number; changed: number; removed: number; unchanged: number };
type PreviewFacts = {
  components: ChangeCounts;
  tokens: ChangeCounts;
  breaking_components: number;
  /** Which components and tokens, by name. Tokens are named only where they changed or were removed. */
  names: {
    newComponents: string[];
    changedComponents: string[];
    /** Already in Contentful and identical, so there is nothing to push. */
    unchangedComponents: string[];
    removedComponents: string[];
    breakingComponents: string[];
    changedTokens: string[];
    removedTokens: string[];
  };
};
type PushFacts = {
  component_types: PushResult['componentTypes'];
  design_tokens: PushResult['designTokens'];
  summary?: PushResult['summary'];
  failure_count?: number;
  failures?: Array<{ entity_type: string; entity_id: string; message: string }>;
  /** What the push did to each entity, by name. Tokens are named only where they were updated, removed or failed. */
  names: {
    createdComponents: string[];
    updatedComponents: string[];
    removedComponents: string[];
    failedComponents: string[];
    updatedTokens: string[];
    removedTokens: string[];
    failedTokens: string[];
  };
};
type ValidationFacts = {
  count: number;
  errors: Array<{ component: string; path: string; message: string }>;
  missing_names: string[];
};

/** What the run is about, stated once when it opens. */
type RunFacts = {
  agent: string;
  credentials_skipped: boolean;
  components_generated: number;
  components_accepted: number;
  tokens: number;
};

export type FlowTrail = {
  startedAt: number;
  stageStartedAt: number;
  /** The step the flow is in now. */
  at: FlowStep;
  facts: RunFacts;
  stages: string[];
  preview?: PreviewFacts;
  push?: PushFacts;
  pushFailed?: boolean;
  saved?: { path: string; run_id: string | null };
  failure?: { step: string; message: string };
  validation?: ValidationFacts;
};

const scrub = (text: string, state: FlowState): string => scrubError(text, [state.cmaToken]);

const seconds = (ms: number): number => Math.round(ms / 100) / 10;

const pushHasFailures = (result: PushResult): boolean =>
  result.componentTypes.failed + result.designTokens.failed > 0 ||
  (result.failures?.length ?? 0) > 0 ||
  (result.summary?.failed ?? 0) > 0;

// Names come from data the server sends, and the log must never get in the way of the import, so reading them is guarded.
const safeList = (read: () => string[]): string[] => {
  try {
    return read();
  } catch {
    return [];
  }
};
const safeCount = (read: () => number): number => {
  try {
    return read();
  } catch {
    return 0;
  }
};

// Named the way the preview screen names them: a new entry by its key, a changed or removed one by its ID.
const newName = (item: unknown): string => {
  const raw = item as Record<string, unknown>;
  return typeof raw['key'] === 'string' ? raw['key'] : typeof raw['$name'] === 'string' ? raw['$name'] : 'unknown';
};

function previewFacts(preview: ServerPreviewResponse): PreviewFacts {
  const counts = (group: {
    new: unknown[];
    changed: unknown[];
    removed: unknown[];
    unchanged: unknown[];
  }): ChangeCounts => ({
    new: safeCount(() => group.new.length),
    changed: safeCount(() => group.changed.length),
    removed: safeCount(() => group.removed.length),
    unchanged: safeCount(() => group.unchanged.length),
  });
  const isBreaking = (entry: (typeof preview.components.changed)[number]): boolean =>
    entry.changeClassification?.classification === 'breaking';
  const componentName = (entry: (typeof preview.components.changed)[number]): string =>
    entry.current?.id ?? entry.current?.name ?? 'unknown';

  return {
    components: counts(preview.components),
    tokens: counts(preview.tokens),
    breaking_components: safeCount(() => preview.components.changed.filter(isBreaking).length),
    names: {
      newComponents: safeList(() => preview.components.new.map(newName)),
      changedComponents: safeList(() => preview.components.changed.map(componentName)),
      unchangedComponents: safeList(() => [...preview.components.unchanged]),
      removedComponents: safeList(() => preview.components.removed.map((entity) => entity.id ?? entity.name)),
      breakingComponents: safeList(() => preview.components.changed.filter(isBreaking).map(componentName)),
      changedTokens: safeList(() => preview.tokens.changed.map((item) => item.current.name)),
      removedTokens: safeList(() => preview.tokens.removed.map((item) => item.name)),
    },
  };
}

function pushFacts(result: PushResult, state: FlowState): PushFacts {
  const failures = result.failures ?? [];
  const items = result.items ?? [];
  const ids = (entityType: string, action: string): string[] =>
    items
      .filter((i) => i.entityType === entityType && i.action === action && i.status === 'succeeded')
      .map((i) => i.id);
  const failedIds = (entityType: string): string[] =>
    items.filter((i) => i.entityType === entityType && i.status === 'failed').map((i) => i.id);
  return {
    component_types: result.componentTypes,
    design_tokens: result.designTokens,
    names: {
      createdComponents: ids('ComponentType', 'create'),
      updatedComponents: ids('ComponentType', 'update'),
      removedComponents: ids('ComponentType', 'delete'),
      failedComponents: failedIds('ComponentType'),
      updatedTokens: ids('DesignToken', 'update'),
      removedTokens: ids('DesignToken', 'delete'),
      failedTokens: failedIds('DesignToken'),
    },
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

// What the flow found out by arriving in a step. Only the error screens carry anything, and only while the flow is on them.
function arrive(trail: FlowTrail, state: FlowState): FlowTrail {
  const next = { ...trail, at: state.step };
  delete next.failure;
  delete next.validation;
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
  const facts: RunFacts = {
    agent: state.agent,
    credentials_skipped: state.credentialsSkipped,
    components_generated: state.generatedCount,
    components_accepted: state.generatedAcceptedCount,
    tokens: state.tokenCount,
  };
  return arrive({ startedAt: now, stageStartedAt: now, at: state.step, facts, stages: [] }, state);
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
  if (from.step === 'previewing' && to.serverPreview) next.preview = previewFacts(to.serverPreview);
  if (from.step === 'pushing') {
    next.push = pushFacts(to.pushResult, to);
    next.pushFailed = pushHasFailures(to.pushResult);
  }
  if (from.step === 'printing' && !failed) next.saved = { path: to.componentsPath, run_id: to.lastRunId };
  return arrive(next, to);
}

export const isFlowFinished = (step: FlowStep): boolean => FINISHED.includes(step);

const changeText = (counts: ChangeCounts): string =>
  `${counts.new} new, ${counts.changed} changed, ${counts.removed} removed, ${counts.unchanged} unchanged`;

const entityText = (counts: PushResult['componentTypes']): string =>
  `${counts.created} created, ${counts.updated} updated, ${counts.removed} removed, ${counts.failed} failed`;

/** What a log section carries: `summary` for a person, `outputs` for AI, both with the same facts. */
type FlowLog = { summary: string[]; outputs: Record<string, unknown> };

/** A list of names as Summary lines, or nothing when there are none. */
const named = (label: string, names: string[], indent: number): string[] =>
  names.length > 0 ? nameLines(label, nameList(names), indent) : [];

/** What the preview found, with the names as lists for AI. */
function previewData(preview: PreviewFacts): Record<string, unknown> {
  const { names, ...counts } = preview;
  return {
    ...counts,
    named: {
      new_components: nameList(names.newComponents),
      changed_components: nameList(names.changedComponents),
      breaking_components: nameList(names.breakingComponents),
      unchanged_components: nameList(names.unchangedComponents),
      removed_components: nameList(names.removedComponents),
      changed_tokens: nameList(names.changedTokens),
      removed_tokens: nameList(names.removedTokens),
    },
  };
}

/** What the push did, with the names as lists for AI. */
function pushData(push: PushFacts): Record<string, unknown> {
  const { names, ...rest } = push;
  return {
    ...rest,
    named: {
      created_components: nameList(names.createdComponents),
      updated_components: nameList(names.updatedComponents),
      removed_components: nameList(names.removedComponents),
      failed_components: nameList(names.failedComponents),
      updated_tokens: nameList(names.updatedTokens),
      removed_tokens: nameList(names.removedTokens),
      failed_tokens: nameList(names.failedTokens),
    },
  };
}

/** The journeys of all the components, as `importJourneys` gives them. Undefined when no step noted any. */
type Journeys = { lines: string[]; data: Record<string, unknown> } | undefined;

function render(trail: FlowTrail, now: number, outcome: string, journeys: Journeys): FlowLog {
  const { facts, preview, push, saved, failure, validation } = trail;
  const total = seconds(now - trail.startedAt);

  const summary = [
    `Agent: ${AGENT_LABELS[facts.agent as AgentName] ?? facts.agent}`,
    `Credentials: ${facts.credentials_skipped ? 'skipped, so nothing was pushed' : 'used'}`,
    `Components: ${facts.components_generated} generated, ${facts.components_accepted} accepted`,
    `Tokens: ${facts.tokens}`,
    'Stages:',
    ...trail.stages.map((stage) => `  ${stage}`),
  ];
  if (preview) {
    const n = preview.names;
    summary.push(
      'Preview:',
      `  Components: ${changeText(preview.components)}${preview.breaking_components > 0 ? ` (${preview.breaking_components} breaking)` : ''}`,
      ...named('New', n.newComponents, 2),
      ...named('Changed', n.changedComponents, 2),
      ...named('Breaking', n.breakingComponents, 2),
      ...named('Unchanged (already in Contentful, so not pushed)', n.unchangedComponents, 2),
      ...named('Removed', n.removedComponents, 2),
      `  Tokens: ${changeText(preview.tokens)}`,
      ...named('Changed tokens', n.changedTokens, 2),
      ...named('Removed tokens', n.removedTokens, 2),
    );
  }
  if (push) {
    const n = push.names;
    summary.push(
      'Push:',
      `  Component types: ${entityText(push.component_types)}`,
      ...named('Created', n.createdComponents, 2),
      ...named('Updated', n.updatedComponents, 2),
      ...named('Removed', n.removedComponents, 2),
      ...named('Failed', n.failedComponents, 2),
      `  Design tokens: ${entityText(push.design_tokens)}`,
      ...named('Updated tokens', n.updatedTokens, 2),
      ...named('Removed tokens', n.removedTokens, 2),
      ...named('Failed tokens', n.failedTokens, 2),
    );
    if (push.failures) {
      summary.push(
        `  Failures: ${push.failure_count}`,
        ...push.failures.map((item) => `    ${item.entity_id} (${item.entity_type}): ${item.message}`),
        ...((push.failure_count ?? 0) > push.failures.length
          ? [`    …and ${(push.failure_count ?? 0) - push.failures.length} more`]
          : []),
      );
    }
  }
  if (saved) summary.push(`Saved to: ${saved.path}${saved.run_id ? ` (run ${saved.run_id})` : ''}`);
  if (failure) summary.push(`Error at ${failure.step}: ${failure.message}`);
  if (validation) {
    summary.push(
      `Preview validation errors: ${validation.count}`,
      ...validation.errors.map((error) => `  ${error.component} at ${error.path}: ${error.message}`),
      ...(validation.count > validation.errors.length
        ? [`  …and ${validation.count - validation.errors.length} more`]
        : []),
      ...(validation.missing_names.length > 0 ? [`  Missing names: ${validation.missing_names.join(', ')}`] : []),
    );
  }
  if (journeys) summary.push(...journeys.lines);
  summary.push(`Time: ${total}s`, `Outcome: ${outcome}`);

  return {
    summary,
    outputs: {
      outcome,
      total_seconds: total,
      ...facts,
      stages: trail.stages,
      ...(preview ? { preview: previewData(preview) } : {}),
      ...(push ? { push: pushData(push) } : {}),
      ...(saved ? { saved } : {}),
      ...(failure ? { error: failure } : {}),
      ...(validation ? { preview_validation: validation } : {}),
      ...(journeys ? { component_journeys: journeys.data } : {}),
    },
  };
}

/**
 * Tells the ledger what the preview and the push found for each component, so the log that ends the run can say what
 * happened to every one. Call it before the log is written.
 */
export function noteFlowJourneys(trail: FlowTrail): void {
  const preview = trail.preview?.names;
  if (preview) {
    noteJourney(preview.newComponents, { preview: 'new' });
    noteJourney(preview.changedComponents, { preview: 'changed' });
    noteJourney(preview.unchangedComponents, { preview: 'unchanged' });
    noteJourney(preview.removedComponents, { preview: 'removed' });
  }
  const push = trail.push?.names;
  if (push) {
    noteJourney(push.createdComponents, { push: 'created' });
    noteJourney(push.updatedComponents, { push: 'updated' });
    noteJourney(push.removedComponents, { push: 'removed' });
    noteJourney(push.failedComponents, { push: 'failed' });
  }
}

/** What a crash or Ctrl+C writes if it cuts the run short. */
export function flowProgress(trail: FlowTrail, now: number, journeys?: Journeys): FlowLog {
  return render(trail, now, `interrupted at ${LABELS[trail.at]}`, journeys);
}

/**
 * How the run ended. `final` is the state it ended in, or undefined when the import was left while the run was open. The
 * outcome names the cause, so a failed push or preview says why in the first line of its own log.
 */
export function flowFinish(
  trail: FlowTrail,
  final: FlowState | undefined,
  now: number,
  journeys?: Journeys,
): FlowLog & { status: 'success' | 'error'; exitMethod: 'saved' | 'discarded' } {
  if (!final) {
    const midWork = WORK.includes(trail.at);
    const outcome = `left the import ${midWork ? 'while' : 'at'} ${LABELS[trail.at]}${midWork ? ' was running' : ''}`;
    return { ...render(trail, now, outcome, journeys), status: midWork ? 'error' : 'success', exitMethod: 'discarded' };
  }

  if (final.step === 'final-review') {
    return {
      ...render(trail, now, 'went back to edit the definitions', journeys),
      status: 'success',
      exitMethod: 'discarded',
    };
  }

  let outcome: string;
  let failed = true;
  if (trail.validation) {
    outcome = `blocked by ${trail.validation.count} preview validation error(s)`;
  } else if (trail.failure) {
    outcome = `failed at ${trail.failure.step}: ${trail.failure.message.slice(0, MAX_OUTCOME)}`;
  } else if (trail.pushFailed) {
    outcome = 'pushed, but some entities failed';
  } else {
    failed = false;
    outcome = final.credentialsSkipped ? 'saved without pushing (credentials skipped)' : 'published';
  }
  return {
    ...render(trail, now, outcome, journeys),
    status: failed ? 'error' : 'success',
    exitMethod: failed ? 'discarded' : 'saved',
  };
}

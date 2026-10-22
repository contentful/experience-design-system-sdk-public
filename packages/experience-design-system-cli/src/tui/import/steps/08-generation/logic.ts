import type { GenerationProgress } from './types.js';
import type { RunningLine } from '../../shared/running-step/logic.js';

export function initialProgress(): GenerationProgress {
  return {
    stage: 'preparing',
    activeComponents: [],
    failedComponents: 0,
    components: null,
    mapTokens: 'idle',
    mapTokensEligible: null,
  };
}

export function shouldRunMapTokens(counts: { mappablePropCount: number; rawTokenCount: number }): boolean {
  return counts.mappablePropCount > 0 && counts.rawTokenCount > 0;
}

export function formatAcceptanceSummary(counts: { accepted: number; autoRejected: number }): string {
  const accepted = `${counts.accepted} component${counts.accepted === 1 ? '' : 's'} accepted`;
  if (counts.autoRejected === 0) return `${accepted}.`;
  return `${accepted}, ${counts.autoRejected} excluded due to validation errors.`;
}

const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

export function describeGeneration(input: { acceptedCount: number; agent: string; hasTokens: boolean }): string {
  const agent = capitalize(input.agent);
  return (
    `${formatAcceptanceSummary({ accepted: input.acceptedCount, autoRejected: 0 })}\n` +
    `${agent} reviews their properties and slots, then creates Contentful Component Definition Format (CDF) definitions.` +
    `${input.hasTokens ? ' Using your design tokens for prop resolution.' : ''}`
  );
}

export function progressRows(progress: GenerationProgress, agent: string): RunningLine[] {
  const name = capitalize(agent);
  const { components, mapTokens, exploration, stage } = progress;
  const rows: RunningLine[] = [];
  if (exploration) {
    const scopeNumber = exploration.scope?.match(/-(\d+)$/)?.[1];
    const labels: Record<typeof exploration.stage, string> = {
      loading: 'Loading source evidence for property and slot reviews...',
      preparing: 'Preparing property and slot reviews...',
      cached: 'Reusing saved property and slot review...',
      exploring: `Reviewing properties and slots via ${name}${scopeNumber ? ` — review pass ${scopeNumber} of ${exploration.total}` : ''}`,
      reconciling: `Comparing reviews and classifying disagreements via ${name}...`,
      verifying: `Verifying disputed findings against source evidence via ${name}...`,
      checking: `Checking evidence supporting verified findings via ${name}...`,
      finalizing: 'Saving property and slot review results...',
      complete: 'Property and slot reviews complete',
    };
    rows.push({
      text: labels[exploration.stage],
      complete: exploration.stage === 'complete',
      ...(['exploring', 'cached'].includes(exploration.stage)
        ? { progress: { done: exploration.done, total: exploration.total, label: 'review passes complete' } }
        : {}),
    });
  }
  if (['preparing', 'saving-decisions', 'authenticating'].includes(stage)) {
    rows.push({
      text:
        stage === 'authenticating'
          ? `Checking ${name} authentication...`
          : stage === 'saving-decisions'
            ? 'Saving selected components...'
            : 'Preparing selected components...',
    });
  } else if (stage === 'exploring' && !exploration) {
    rows.push({ text: 'Preparing property and slot reviews...' });
  }
  if (components) {
    if (progress.resumedComponents)
      rows.push({
        text: `Reused ${progress.resumedComponents} completed component definitions from this debug session`,
        complete: true,
      });
    const finished = components.done >= components.total && progress.activeComponents.length === 0;
    rows.push({
      text: finished
        ? progress.failedComponents
          ? `Definition generation finished — ${progress.failedComponents} failed`
          : 'Component definitions ready'
        : `Generating component definitions via ${name}...`,
      complete: finished,
      progress: { done: components.done, total: components.total },
    });
    for (const active of progress.activeComponents) {
      rows.push({
        text: active.exploringModel
          ? `Exploring a new model Component for ${active.name}`
          : active.attempt > 1
            ? `Retrying ${active.name} — attempt ${active.attempt} of ${active.maxAttempts}`
            : `Generating ${active.name}`,
      });
    }
    if (!finished && !progress.activeComponents.length)
      rows.push({ text: 'Preparing the next component definition...' });
  }
  if (stage === 'preparing-token-mapping') {
    rows.push({ text: 'Checking which properties can use design tokens...' });
  }
  if (mapTokens !== 'idle') {
    rows.push({
      text: mapTokens === 'running' ? `Mapping token restrictions via ${name}...` : 'Token restrictions ready',
      complete: mapTokens === 'complete',
    });
  }
  return rows;
}

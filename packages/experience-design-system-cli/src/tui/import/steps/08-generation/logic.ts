import type { GenerationProgress } from './types.js';

export function initialProgress(): GenerationProgress {
  return { components: null, mapTokens: 'idle', mapTokensEligible: null };
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
    `${agent} is reading each selected component and writing a Contentful component definition for it` +
    `${input.hasTokens ? ' Using your design tokens for prop resolution.' : ''}`
  );
}

export function progressRows(
  progress: GenerationProgress,
  agent: string,
): Array<{ text: string; complete: boolean; progress?: { done: number; total: number } }> {
  const name = capitalize(agent);
  const { components, mapTokens } = progress;
  const rows: Array<{ text: string; complete: boolean; progress?: { done: number; total: number } }> = [
    {
      text: components ? components.current : `Starting up ${name}...`,
      complete: false,
      ...(components ? { progress: { done: components.done, total: components.total } } : {}),
    },
  ];
  if (mapTokens !== 'idle') {
    rows.push({
      text: mapTokens === 'running' ? `Mapping token restrictions via ${name}...` : 'Token restrictions ready',
      complete: mapTokens === 'complete',
    });
  }
  return rows;
}

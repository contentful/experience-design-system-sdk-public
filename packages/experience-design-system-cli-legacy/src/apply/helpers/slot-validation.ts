import { parseCDFComponents, validateSlotReferences } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry, CDFValidationError } from '@contentful/experience-design-system-types';
import { findSlotCycles, suggestCycleBreakEdge, formatCyclePath } from '../../analyze/cycle-detection.js';
import { exitWithAnalytics } from '../../analytics/index.js';

export function detectSlotCycles(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): ReturnType<typeof findSlotCycles> {
  const cycleInput = components.map(({ key, entry }) => ({
    name: key,
    slots: Object.entries(entry.$slots ?? {}).map(([slotName, slotDef]) => ({
      name: slotName,
      allowedComponents: slotDef.$allowedComponents ?? [],
    })),
  }));
  return findSlotCycles(cycleInput);
}

export function formatSlotCycleReport(cycles: ReturnType<typeof findSlotCycles>): string[] {
  const lines: string[] = [];
  lines.push(
    `Error: manifest:components/slot-cycles — ${cycles.length} slot dependency cycle(s) detected. Push refused.`,
  );
  for (let i = 0; i < cycles.length; i += 1) {
    const cycle = cycles[i];
    lines.push(`  Cycle ${i + 1}: ${formatCyclePath(cycle)}`);
    const suggested = suggestCycleBreakEdge(cycle, cycles);
    lines.push(
      `    Fix: remove '${suggested.toComponent}' from ${suggested.fromComponent}.$slots.${suggested.slotName}.$allowedComponents`,
    );
  }
  return lines;
}

export async function assertNoSlotCycles(components: Array<{ key: string; entry: CDFComponentEntry }>): Promise<void> {
  const cycles = detectSlotCycles(components);
  if (cycles.length === 0) return;
  process.stderr.write(formatSlotCycleReport(cycles).join('\n') + '\n');
  await exitWithAnalytics(1);
}

export function formatUnresolvedSlotReferences(errors: CDFValidationError[]): string[] {
  const lines = ['Error: CDF slot $allowedComponents references failed to resolve locally. Push refused.'];
  for (const error of errors) {
    lines.push(`  - ${error.message} (${error.path})`);
  }
  return lines;
}

export async function assertNoUnresolvedSlotReferences(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): Promise<void> {
  const errors = validateSlotReferences(components);
  if (errors.length === 0) return;
  process.stderr.write(formatUnresolvedSlotReferences(errors).join('\n') + '\n');
  await exitWithAnalytics(1);
}

export function extractComponents(
  cdf: Record<string, unknown> | null | undefined,
): Array<{ key: string; entry: CDFComponentEntry }> {
  if (!cdf) return [];
  return parseCDFComponents(cdf).components;
}

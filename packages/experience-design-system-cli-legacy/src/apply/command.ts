import type { Command } from 'commander';
import { runApply } from './controller/run-apply.js';

export { readTokensFromPath, toCDFTokens } from './helpers/read-token-files.js';
export {
  detectSlotCycles,
  formatSlotCycleReport,
  assertNoSlotCycles,
  formatUnresolvedSlotReferences,
  assertNoUnresolvedSlotReferences,
  extractComponents,
} from './helpers/slot-validation.js';
export { hasBreakingChangesWithImpact } from './helpers/apply-output-builders.js';

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .description('Write component types and design tokens to Contentful ExO')
    .helpOption(false)
    .argument('<file>', 'CDF file containing all component and design token definitions')
    .action(async (file: string) => {
      await runApply(file);
    });
}

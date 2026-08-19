import type { DsiCliCommand } from './types.js';

const COMMAND_MAP: Record<string, DsiCliCommand> = {
  'analyze extract': 'analyze_extract',
  'analyze select': 'analyze_select',
  'analyze select-agent': 'analyze_select',
  'generate components': 'generate_components',
  'generate tokens': 'generate_tokens',
  'generate edit': 'generate_edit',
  'apply preview': 'apply_preview',
  'apply select': 'apply_select',
  'apply push': 'apply_push',
  'print components': 'print_components',
  'print tokens': 'print_tokens',
  import: 'import',
};

/** Map a Commander command chain (e.g. "apply push") to a tracked command id, if any. */
export function normalizeCommand(commandChain: string): DsiCliCommand | undefined {
  return COMMAND_MAP[commandChain];
}

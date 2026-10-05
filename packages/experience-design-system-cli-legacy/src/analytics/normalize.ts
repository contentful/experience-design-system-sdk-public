import type { DsiCliCommand } from './types.js';

const COMMAND_MAP: Record<string, DsiCliCommand> = {
  'analyze extract': 'analyze_extract',
  'analyze select': 'analyze_select',
  'generate components': 'generate_components',
  'generate tokens': 'generate_tokens',
  'map tokens': 'map_tokens',
  apply: 'apply_push',
  'print components': 'print_components',
  'print tokens': 'print_tokens',
  import: 'import',
};

/** Map a Commander command chain (e.g. "apply") to a tracked command id, if any. */
export function normalizeCommand(commandChain: string): DsiCliCommand | undefined {
  return COMMAND_MAP[commandChain];
}

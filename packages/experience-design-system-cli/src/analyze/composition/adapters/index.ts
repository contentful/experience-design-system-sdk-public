import type { BuiltinAdapter } from './types.js';
import { requiredParentAdapter } from './required-parent.js';

export type { AdapterInput, CompositionAdapter, BuiltinAdapter } from './types.js';
export { requiredParentAdapter, normalizeToComponentName } from './required-parent.js';

/** All v1 built-in native-format adapters (spec T6). */
export const BUILTIN_ADAPTERS: BuiltinAdapter[] = [
  {
    name: 'required-parent',
    candidateGlobs: ['**/*.ts', '**/*.tsx'],
    adapter: requiredParentAdapter,
  },
];

export function getBuiltinAdapter(name: string): BuiltinAdapter | undefined {
  return BUILTIN_ADAPTERS.find((a) => a.name === name);
}

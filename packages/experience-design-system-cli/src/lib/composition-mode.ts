export const COMPOSITION_MODES = ['composite', 'atomic'] as const;

export type CompositionMode = (typeof COMPOSITION_MODES)[number];

export function isCompositionMode(value: string): value is CompositionMode {
  return (COMPOSITION_MODES as readonly string[]).includes(value);
}

/**
 * Options that, when present, IMPLY composite mode — passing any of them is a
 * clear opt-in, so requiring an explicit `--composite` alongside is redundant.
 */
export type CompositionSourceOptions = {
  compositionRefresh?: boolean;
  generateMap?: string;
};

function hasCompositionSource(opts: CompositionSourceOptions): boolean {
  return !!opts.compositionRefresh || !!opts.generateMap;
}

/**
 * Resolve the effective composition mode with precedence
 * `explicit flag > implied source > env > persisted config > default`.
 * Default is `atomic` (composition OFF); opting into composite mode enables
 * the hierarchy machinery. Passing a composition source implies composite.
 */
export function resolveCompositionMode(
  opts: { composite?: boolean; atomic?: boolean } & CompositionSourceOptions,
  configMode?: CompositionMode,
): CompositionMode {
  if (opts.composite) return 'composite';
  if (opts.atomic) return 'atomic';

  // A composition source is an explicit opt-in for this invocation — it beats
  // env/config, but not an explicit --atomic (handled above).
  if (hasCompositionSource(opts)) return 'composite';

  const env = process.env['EXPERIENCES_COMPOSITION_MODE'];
  if (env !== undefined && env !== '') {
    const v = env.toLowerCase();
    if (isCompositionMode(v)) return v;
  }

  if (configMode && isCompositionMode(configMode)) return configMode;
  return 'atomic';
}

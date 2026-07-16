export type CompositionMode = 'composite' | 'atomic';

/**
 * Options that, when present, IMPLY composite mode — passing any of them is a
 * clear opt-in, so requiring an explicit `--composite` alongside is redundant.
 */
export type CompositionSourceOptions = {
  compositionMap?: string;
  compositionAdapter?: string;
  compositionAgent?: boolean;
  compositionRefresh?: boolean;
  generateMap?: string;
};

function hasCompositionSource(opts: CompositionSourceOptions): boolean {
  return (
    !!opts.compositionMap ||
    !!opts.compositionAdapter ||
    !!opts.compositionAgent ||
    !!opts.compositionRefresh ||
    !!opts.generateMap
  );
}

/**
 * Resolve the effective composition mode with precedence
 * `explicit flag > implied source > env > persisted config > default`.
 * Default is `atomic` (composition OFF); `--composite` opts into the hierarchy
 * machinery.
 *
 * `--atomic` is accepted for symmetry and wins when passed — even alongside a
 * composition source, since it's an explicit "no" that overrides the implicit
 * opt-in. If both `--composite` and `--atomic` are present, `--composite`
 * wins. Passing a composition source (`--composition-map/-adapter/-agent`,
 * `--composition-refresh`, or `--generate-map`) implies composite without a
 * separate `--composite`.
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
    if (v === 'composite') return 'composite';
    if (v === 'atomic') return 'atomic';
  }

  if (configMode === 'composite' || configMode === 'atomic') return configMode;
  return 'atomic';
}

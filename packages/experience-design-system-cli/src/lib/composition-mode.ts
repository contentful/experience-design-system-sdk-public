export type CompositionMode = 'composite' | 'atomic';

/**
 * Resolve the effective composition mode with precedence
 * `flag > env > persisted config > default`. Default is `atomic`
 * (composition OFF); `--composite` opts into the hierarchy machinery.
 *
 * `--atomic` is accepted for symmetry (redundant with the default) and
 * wins over env/config when passed. If both `--composite` and `--atomic`
 * are somehow present, `--composite` takes precedence (opting in is the
 * explicit intent).
 */
export function resolveCompositionMode(
  opts: { composite?: boolean; atomic?: boolean },
  configMode?: CompositionMode,
): CompositionMode {
  if (opts.composite) return 'composite';
  if (opts.atomic) return 'atomic';

  const env = process.env['EXPERIENCES_COMPOSITION_MODE'];
  if (env !== undefined && env !== '') {
    const v = env.toLowerCase();
    if (v === 'composite') return 'composite';
    if (v === 'atomic') return 'atomic';
  }

  if (configMode === 'composite' || configMode === 'atomic') return configMode;
  return 'atomic';
}

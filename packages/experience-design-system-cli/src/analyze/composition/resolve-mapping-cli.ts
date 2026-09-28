export type CompositionCliOptions = {
  /** `--composition-refresh` — force edge emission to run even over resolved residue. */
  compositionRefresh?: boolean;
};

export type ResolvedCompositionSources = {
  forceAgent: boolean;
};

export function resolveCompositionSources(opts: CompositionCliOptions): ResolvedCompositionSources {
  return {
    forceAgent: !!opts.compositionRefresh,
  };
}

export type CompositionCliOptions = {
  /** `--composition-refresh` — force edge emission to run even over resolved residue. */
  compositionRefresh?: boolean;
  /** `--no-cache` — force the composition agent to rerun with the rest of the pipeline. */
  noCache?: boolean;
};

export type ResolvedCompositionSources = {
  forceAgent: boolean;
};

export function resolveCompositionSources(opts: CompositionCliOptions): ResolvedCompositionSources {
  return {
    forceAgent: opts.compositionRefresh === true || opts.noCache === true,
  };
}

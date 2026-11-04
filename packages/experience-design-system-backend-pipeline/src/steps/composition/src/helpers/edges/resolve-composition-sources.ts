export type CompositionCliOptions = {
  /** @deprecated Composition always collects fresh deterministic evidence. */
  compositionRefresh?: boolean;
  /** @deprecated Composition does not read agent results. */
  noCache?: boolean;
};

export type ResolvedCompositionSources = {
  forceAgent: false;
};

/** @deprecated Composition no longer invokes an agent. */
export function resolveCompositionSources(_opts: CompositionCliOptions): ResolvedCompositionSources {
  return {
    forceAgent: false,
  };
}

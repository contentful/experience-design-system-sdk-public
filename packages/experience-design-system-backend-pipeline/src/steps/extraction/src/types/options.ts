import type { ComponentObservationLimits } from './component-source-observations.js';
import type { ComponentFactCollectors } from './component-facts.js';
/**
 * Optional extraction-time settings forwarded from the CLI through the
 * pipeline to each extractor; supported settings are consumed by each adapter.
 */
export interface ExtractorOptions {
  /** Additional admitted compiler context; these paths never become output roots. */
  evidenceFilePaths?: readonly string[];
  /** Optional field-local component observation collectors; overrides replace the React default field collector. */
  componentFactCollectors?: ComponentFactCollectors;
  sourceClosureMaxIterations?: number;
  componentObservationLimits?: Partial<ComponentObservationLimits>;
  /**
   * Whether the Svelte extractor should run a retry pass for components whose
   * declared Props type could not be resolved on the first pass (cross-package
   * extends, path-alias-only types, etc.). See svelte.ts for the policy.
   */
  resolveUnreachable?: 'auto' | 'always' | 'never';
  /** Absolute project root — used by the retry pass to locate tsconfig.json and node_modules. */
  projectRoot?: string;
  /** Optional cooperative cancellation for bounded compiler analysis. */
  signal?: AbortSignal;
}

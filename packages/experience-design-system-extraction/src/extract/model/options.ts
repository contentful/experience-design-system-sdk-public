/**
 * Optional extraction-time settings forwarded from the CLI through the
 * pipeline to each extractor. Only the Svelte extractor currently consumes
 * any of these; other extractors ignore the value.
 */
export interface ExtractorOptions {
  /**
   * Whether the Svelte extractor should run a retry pass for components whose
   * declared Props type could not be resolved on the first pass (cross-package
   * extends, path-alias-only types, etc.). See svelte.ts for the policy.
   */
  resolveUnreachable?: 'auto' | 'always' | 'never';
  /** Absolute project root — used by the retry pass to locate tsconfig.json and node_modules. */
  projectRoot?: string;
}

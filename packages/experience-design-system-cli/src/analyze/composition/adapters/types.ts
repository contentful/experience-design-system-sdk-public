import type { CompositionEdge } from '../interchange-schema.js';

/**
 * Native-format adapter contract (spec T6).
 *
 * An adapter maps a design-system's own composition convention (e.g. Porsche's
 * `requiredParent` field) into the CLI's neutral `CompositionEdge[]` view.
 *
 * Adapters are PURE functions: they do no file I/O of their own. The resolver
 * reads candidate files up front and hands their contents in via `AdapterInput`.
 */
export type AdapterInput = {
  files: { path: string; content: string }[];
  componentNames: Set<string>;
};

export type CompositionAdapter = (ctx: AdapterInput) => CompositionEdge[];

/**
 * A built-in adapter plus the metadata a pre-filter needs to decide which files
 * to read and feed it. `candidateGlobs` are matched against source paths so the
 * resolver only slurps files an adapter could plausibly care about.
 */
export type BuiltinAdapter = {
  name: string;
  candidateGlobs: string[];
  adapter: CompositionAdapter;
};

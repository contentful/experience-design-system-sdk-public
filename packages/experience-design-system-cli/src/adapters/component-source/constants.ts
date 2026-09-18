// Mirrors analyze/select-agent/context-builder.ts's MAX_COMPONENT_SOURCE_CHARS
// convention for bounding inlined source in an agent prompt.
export const MAX_COMPONENT_SOURCE_CHARS = 8_000;
// Mirrors analyze/select-agent/context-builder.ts's MAX_SIBLING_FILES /
// MAX_SIBLING_SNIPPET_CHARS conventions — small, purpose-built duplicate
// rather than importing that module's SelectionContext machinery, which is
// built for a different command (analyze select-agent).
export const MAX_SIBLING_FILES = 5;
export const MAX_SIBLING_SNIPPET_CHARS = 1_200;
// A type-declaring sibling (e.g. `*.types.ts`) needs a bigger budget than a
// styles module — the styles-module budget can cut mid-array.
export const MAX_TYPE_DECLARING_SIBLING_CHARS = 4_000;
// Caps how many siblings get the enlarged budget, since a type is usually
// declared in only one or two files.
export const MAX_ENLARGED_SIBLINGS = 2;
// A token-resolution map sometimes lives behind a component that itself
// re-exports another component's prop (A imports B, B imports B's own
// styles module) rather than beside the component being classified. Two hops
// covers "the component's own imports" plus "those imports' own imports"
// without walking the whole dependency graph.
export const MAX_SIBLING_DEPTH = 2;
// Caps total files read while *discovering* candidates (before the
// MAX_SIBLING_FILES inlining cap applies), independent of how many end up
// inlined — bounds cost when a hop-1 import is a barrel file with many
// re-exports, each of which would otherwise be walked for a second hop.
export const MAX_SIBLING_CANDIDATES_EXPLORED = 25;
export const RELATIVE_IMPORT_PATTERN = /from\s+['"](\.[^'"]+)['"]/g;
export const SIBLING_FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
// TS node16/nodenext/bundler resolution requires the *emitted* extension in
// the specifier (`./Badge.types.js` for a file named `Badge.types.ts`).
export const TS_ESM_EXTENSION_REWRITES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['.js', ['.ts', '.tsx', '.js', '.jsx']],
  ['.jsx', ['.tsx', '.jsx']],
  ['.mjs', ['.mts', '.mjs']],
  ['.cjs', ['.cts', '.cjs']],
];
// A prop typed as a named alias (`variant: BadgeVariantS1`) carries none of
// its own members — the type name is a search name too, so we can window on it.
export const IDENTIFIER_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

export interface TokenIndexEntry {
  path: string;
  type: string;
}

/** Leaf DTCG token paths, keyed by dot-notation path. Groups are not indexed. */
export type TokenIndex = Map<string, TokenIndexEntry>;

/** Raw design-system token name (as written in source) to DTCG dot path. */
export type TokenSidecar = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walks a DTCG tree and indexes every leaf token. A node is a token when it
 * carries `$value`; anything else is a group. `$type` is resolved from the
 * node itself or inherited from the nearest ancestor that declares one, which
 * is how DTCG permits a group to type all of its descendants.
 */
export function buildTokenIndex(tree: unknown): TokenIndex {
  const index: TokenIndex = new Map();

  const walk = (node: unknown, segments: string[], inheritedType: string | undefined): void => {
    if (!isRecord(node)) return;

    const declaredType = typeof node.$type === 'string' ? node.$type : undefined;
    const effectiveType = declaredType ?? inheritedType;

    if ('$value' in node) {
      if (segments.length > 0 && effectiveType !== undefined) {
        const path = segments.join('.');
        index.set(path, { path, type: effectiveType });
      }
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      walk(child, [...segments, key], effectiveType);
    }
  };

  walk(tree, [], undefined);
  return index;
}

/**
 * Resolves a token reference as written in component source to an indexed
 * token. A reference already shaped like a DTCG path resolves directly;
 * anything else must be present in the sidecar. Resolution succeeds only when
 * the result exists in the index, which is what makes a token classification
 * provable rather than inferred.
 */
export function resolveTokenReference(
  ref: string,
  sidecar: TokenSidecar,
  index: TokenIndex,
): TokenIndexEntry | undefined {
  const trimmed = ref.trim();
  if (trimmed === '') return undefined;

  const varMatch = /^var\(\s*(--[^,)\s]+)/.exec(trimmed);
  const candidates = varMatch ? [varMatch[1], trimmed] : [trimmed];

  for (const candidate of candidates) {
    const direct = index.get(candidate);
    if (direct) return direct;

    const mapped = sidecar[candidate];
    if (mapped !== undefined) {
      const viaSidecar = index.get(mapped);
      if (viaSidecar) return viaSidecar;
    }
  }

  return undefined;
}

export interface SourceFile {
  path: string;
  text: string;
}

// Reference shapes seen across real design systems: a flat/dotted JS accessor
// (`tokens.blue500`), a CSS custom property (`var(--brand-primary)`), and a
// quoted DTCG dot path (`'color.blue.500'`). Ordered most to least specific.
const REFERENCE_PATTERNS: RegExp[] = [
  /var\(\s*--[^,)\s]+\s*\)/,
  /\btokens\s*(?:\.[A-Za-z0-9_$]+)+/,
  /\btheme\s*(?:\.[A-Za-z0-9_$]+)+/,
  /['"`]((?:[A-Za-z0-9_-]+\.){2,}[A-Za-z0-9_-]+)['"`]/,
  /['"`](--[A-Za-z0-9_-]+)['"`]/,
];

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findReferenceInWindow(window: string): string | undefined {
  for (const pattern of REFERENCE_PATTERNS) {
    const match = pattern.exec(window);
    if (match) {
      // Quoted forms capture the inner value; bare accessors match whole.
      return (match[1] ?? match[0]).replace(/\s+/g, '');
    }
  }
  return undefined;
}

/**
 * Slices the value bound to a branch marker, bounded by the enclosing
 * object-literal/array/call — not a fixed character count — so the window
 * can never read past this branch into a sibling key's value. Ends at the
 * first depth-0 `,` or `;`, or at a closing bracket that would leave the
 * literal the marker was found in.
 */
function sliceBranchValue(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '(' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ')' || ch === ']') {
      if (depth === 0) return text.slice(start, i);
      depth--;
    } else if ((ch === ',' || ch === ';') && depth === 0) {
      return text.slice(start, i);
    }
  }
  return text.slice(start);
}

/**
 * For each of a prop's values, finds the token reference its branch resolves
 * to, if any. Recognises object-literal keys (`neutral:`), quoted keys
 * (`'neutral':`) and switch cases (`case 'neutral':`), then scans the value
 * bound to each occurrence of the marker across all sources.
 *
 * A value's branch marker can occur more than once across the supplied
 * sources — e.g. two side-by-side variant maps that both happen to use the
 * same keys for unrelated things (an icon-color map and a background-color
 * map). When those occurrences disagree on the reference, which one is "the"
 * map for this prop is ambiguous, so the value is left unresolved rather than
 * silently picking one — a wrong pairing is worse than an honest miss.
 */
export function findValueTokenReferences(
  values: string[],
  sources: SourceFile[],
): Map<string, string> {
  const found = new Map<string, string>();

  for (const value of values) {
    const escaped = escapeForRegExp(value);
    const markers = [
      new RegExp(`case\\s*['"\`]${escaped}['"\`]\\s*:`, 'g'),
      new RegExp(`['"\`]${escaped}['"\`]\\s*:`, 'g'),
      new RegExp(`(?<![A-Za-z0-9_$.])${escaped}\\s*:`, 'g'),
    ];

    const references = new Set<string>();

    for (const source of sources) {
      for (const marker of markers) {
        marker.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = marker.exec(source.text)) !== null) {
          const start = match.index + match[0].length;
          const reference = findReferenceInWindow(sliceBranchValue(source.text, start));
          if (reference !== undefined) references.add(reference);
        }
      }
    }

    if (references.size === 1) {
      found.set(value, [...references][0]);
    }
  }

  return found;
}

export type TokenBindingResult =
  | { status: 'proven'; kind: string; paths: string[] }
  | { status: 'partial'; resolved: string[]; unresolved: string[] }
  | { status: 'none' };

export interface TokenBindingInput {
  values: string[];
  sources: SourceFile[];
  sidecar: TokenSidecar;
  index: TokenIndex;
}

/**
 * Decides whether a design prop is backed by design tokens by proving it,
 * rather than inferring it: every one of the prop's values must resolve
 * through its source-declared reference to a token that exists in the token
 * document, and all of them must share one token type.
 *
 * A partial result is never promoted. Some values resolving means the prop
 * mixes token-backed and hand-coded branches, and emitting only the resolved
 * subset would leave the remaining variants unreachable to an author.
 */
export function proveTokenBinding(input: TokenBindingInput): TokenBindingResult {
  const { values, sources, sidecar, index } = input;
  if (values.length === 0) return { status: 'none' };

  const references = findValueTokenReferences(values, sources);

  const resolved: string[] = [];
  const unresolved: string[] = [];
  const paths: string[] = [];
  const kinds = new Set<string>();

  for (const value of values) {
    const reference = references.get(value);
    const entry = reference === undefined ? undefined : resolveTokenReference(reference, sidecar, index);
    if (entry === undefined) {
      unresolved.push(value);
      continue;
    }
    resolved.push(value);
    kinds.add(entry.type);
    if (!paths.includes(entry.path)) paths.push(entry.path);
  }

  if (resolved.length === 0) return { status: 'none' };
  if (unresolved.length > 0 || kinds.size !== 1) {
    return { status: 'partial', resolved, unresolved };
  }

  return { status: 'proven', kind: [...kinds][0], paths };
}

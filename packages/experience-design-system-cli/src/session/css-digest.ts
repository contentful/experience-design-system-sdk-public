/**
 * Distills a stylesheet down to the evidence relevant to a component's
 * props: which attribute selectors match a (kebab-cased) prop name, what
 * values they take, and what `var(--*)` tokens their declaration blocks
 * reference. Raw Lit/web-component CSS runs 12-30KB against a ~1,200-char
 * sibling budget — a digest instead of a window keeps the evidence readable
 * without blowing the budget (see the E5 CSS-digest handoff).
 */

const MAX_VAR_REFS_PER_ATTR = 20;

export interface CssDigestEntry {
  /** Kebab-cased attribute name, as it appears in the selector. */
  attr: string;
  /** Distinct values from `[attr="value"]` selectors. Empty when only a bare `[attr]` selector was seen. */
  values: string[];
  /** True when at least one bare `[attr]` (no `="value"`) selector matched — signals a boolean prop, not an enum. */
  isBoolean: boolean;
  /** Distinct `var(--*)` references inside the declaration blocks of matching rules, capped at MAX_VAR_REFS_PER_ATTR. */
  varRefs: string[];
}

function kebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Splits CSS into `{ selector, body }` rule pairs, cutting only on a rule's
 * closing `}` — never mid-declaration, since CSS is rule-structured (unlike
 * the char-window used for TS/JS siblings elsewhere in this file).
 */
function parseRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = -1;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    // Comments are skipped before quote tracking: an apostrophe in prose
    // (`/* cascade badge's size */`) is not a string delimiter, but the
    // scanner cannot know that once it is already inside a quote state. An
    // unpaired one would otherwise open a quote that never closes and
    // swallow every rule after it.
    if (!quote && ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      // Unterminated comment: skip only the opener and keep scanning. Strict
      // CSS would treat the rest of the file as comment, but this is an
      // evidence harvester — dropping every remaining rule over one typo
      // costs more than the stray text it lets through.
      if (end !== -1) i = end + 1;
      else i += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '{') {
      if (depth === 0) {
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && bodyStart !== -1) {
        rules.push({ selector: css.slice(selectorStart, bodyStart - 1), body: css.slice(bodyStart, i) });
        selectorStart = i + 1;
        bodyStart = -1;
      }
    }
  }
  return rules;
}

const VAR_REF_PATTERN = /var\((--[a-zA-Z0-9_-]+)/g;

function extractVarRefs(body: string): string[] {
  const refs = new Set<string>();
  for (const match of body.matchAll(VAR_REF_PATTERN)) refs.add(match[1]);
  return [...refs];
}

/**
 * Builds one digest entry per prop name that has at least one matching
 * attribute selector in `css`. A prop with no selector present is omitted
 * entirely — the digest is a lower bound on the vocabulary, never proof of
 * absence (an unstyled default like `size="m"` needs no rule at all).
 */
export function digestCss(css: string, propNames: string[]): CssDigestEntry[] {
  const kebabToProp = new Map(propNames.map((name) => [kebabCase(name), name]));
  const rules = parseRules(css);

  const valuesByAttr = new Map<string, Set<string>>();
  const booleanByAttr = new Map<string, boolean>();
  const varRefsByAttr = new Map<string, Set<string>>();
  const orderedAttrs: string[] = [];

  for (const { selector, body } of rules) {
    const attrPattern = /\[([a-z0-9-]+)(?:="([^"]*)")?\]/g;
    for (const match of selector.matchAll(attrPattern)) {
      const attr = match[1];
      if (!kebabToProp.has(attr)) continue;
      const value = match[2];

      if (!valuesByAttr.has(attr)) {
        valuesByAttr.set(attr, new Set());
        booleanByAttr.set(attr, false);
        varRefsByAttr.set(attr, new Set());
        orderedAttrs.push(attr);
      }
      if (value === undefined) {
        booleanByAttr.set(attr, true);
      } else {
        valuesByAttr.get(attr)!.add(value);
      }
      for (const ref of extractVarRefs(body)) varRefsByAttr.get(attr)!.add(ref);
    }
  }

  return orderedAttrs.map((attr) => ({
    attr,
    values: [...valuesByAttr.get(attr)!].sort(),
    isBoolean: booleanByAttr.get(attr)!,
    varRefs: [...varRefsByAttr.get(attr)!].slice(0, MAX_VAR_REFS_PER_ATTR),
  }));
}

/**
 * Renders a digest as its own labelled prompt block, distinct from source
 * excerpts — so the classifier does not mistake distilled evidence for the
 * component's own code. States the two limits the digest cannot paper over:
 * it is a lower bound (unstyled defaults have no selector) and a bare
 * attribute is boolean, not a one-value enum.
 */
export function renderCssDigest(path: string, entries: CssDigestEntry[]): string {
  if (entries.length === 0) return '';

  const lines = entries.map((entry) => {
    if (entry.isBoolean) return `[boolean] ${entry.attr}`;
    const varsSuffix = entry.varRefs.length > 0 ? `  vars: ${entry.varRefs.join(', ')}` : '';
    return `${entry.attr}: ${entry.values.join(', ')}${varsSuffix}`;
  });

  return (
    `##### CSS digest \`${path}\`\n` +
    `Distinct attribute selectors matching this component's props, extracted from the stylesheet (not the component's own code).\n` +
    lines.join('\n') +
    `\n\nLimits: this is a lower bound on the vocabulary — a prop's default value often has no selector of its own (e.g. an unstyled default). ` +
    `A line marked [boolean] is a bare \`[attr]\` selector — it signals a boolean prop, not a one-value enum.`
  );
}

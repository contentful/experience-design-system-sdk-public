/**
 * Detects whether a design property is actually read by the component that
 * declares it.
 *
 * A property that is declared but never read carries no evidence about how its
 * value is used, so it cannot support a token classification: a token-typed
 * property is resolved to the token's raw value before delivery, and nothing in
 * the component consumes that value. Reporting the absence lets the classifier
 * fall back to the safe answer instead of inferring one from the property name.
 *
 * The scan is deliberately asymmetric. Recognising consumption is generous —
 * a false positive only withdraws the signal, leaving the classifier where it
 * already was. Claiming a property is unconsumed is conservative, because that
 * claim is presented to the classifier as fact.
 */

export interface SourceFile {
  path: string;
  text: string;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `props.margin`, `props?.margin`, `this.props.margin`. */
function hasMemberAccess(name: string, text: string): boolean {
  return new RegExp(`\\bprops\\s*\\??\\.\\s*${escapeForRegExp(name)}\\b`).test(text);
}

function findMatchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * A binding inside a destructuring pattern whose initialiser is `props`. Every
 * entry in such a pattern is a binding, so a renamed (`margin: m`) or defaulted
 * (`margin = 'none'`) entry counts as much as a bare one.
 */
const DESTRUCTURING_INITIALISER = /^\s*(?::[^=]*?)?=\s*(?:this\.)?props\b/;

function hasPropsDestructuring(name: string, text: string): boolean {
  const declaration = /(?:const|let|var)\s*\{/g;
  const binding = new RegExp(`(?:^|[{,\\s])${escapeForRegExp(name)}\\s*(?:[,}:=]|$)`);

  let match: RegExpExecArray | null;
  while ((match = declaration.exec(text)) !== null) {
    const open = text.indexOf('{', match.index);
    const close = findMatchingBrace(text, open);
    if (close === -1) continue;
    if (!DESTRUCTURING_INITIALISER.test(text.slice(close + 1, close + 64))) continue;
    if (binding.test(text.slice(open + 1, close))) return true;
  }
  return false;
}

/**
 * A bare shorthand entry in any brace block — `{ margin, padding }`. This
 * covers a destructured function parameter and a property forwarded on into a
 * call, without needing to know which of the two it is.
 *
 * Only the bare form counts. `{ margin: 0 }` is a CSS declaration in a style
 * object, and a design system's style files are full of them; treating those as
 * uses would silence this scan on precisely the spacing properties it needs to
 * report.
 */
function hasBareShorthand(name: string, text: string): boolean {
  const shorthand = new RegExp(`(?:^|[{,\\s])${escapeForRegExp(name)}\\s*[,}]`);

  for (let open = text.indexOf('{'); open !== -1; open = text.indexOf('{', open + 1)) {
    const close = findMatchingBrace(text, open);
    if (close === -1) continue;
    const body = text.slice(open + 1, close);
    // Only the innermost block owns its entries; an outer block sees this one
    // on its own pass.
    if (body.includes('{')) continue;
    // A pattern with an initialiser is a destructuring declaration, which
    // hasPropsDestructuring already judges — and it judges it on whether the
    // initialiser is actually `props`. Letting the shorthand form fire here too
    // would count `const { margin } = styles` as a use of the property.
    if (/^\s*(?::[^=]*?)?=/.test(text.slice(close + 1, close + 64))) continue;
    if (shorthand.test(body)) return true;
  }
  return false;
}

/** True when any supplied source shows the property being read. */
export function isPropConsumed(name: string, sources: SourceFile[]): boolean {
  if (!name) return false;
  return sources.some(
    (source) =>
      hasMemberAccess(name, source.text) ||
      hasPropsDestructuring(name, source.text) ||
      hasBareShorthand(name, source.text),
  );
}

/**
 * The subset of `propNames` that no supplied source shows being read.
 *
 * Returns an empty list when there is no source to read, because "we found no
 * use" and "we had nothing to look at" are different claims and only the first
 * is worth reporting.
 */
export function findUnconsumedProps(propNames: string[], sources: SourceFile[]): string[] {
  const readable = sources.filter((source) => source.text.trim().length > 0);
  if (readable.length === 0) return [];
  return propNames.filter((name) => name.length > 0 && !isPropConsumed(name, readable));
}

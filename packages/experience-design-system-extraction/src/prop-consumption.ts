import ts from 'typescript';

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

interface SourceAnalysis {
  /** Property names bound directly in executable function parameter patterns. */
  parameterBindings: Set<string>;
  /**
   * True when the component hands the remainder of its props on unchanged —
   * a rest element in a props pattern (`{ a, ...rest }`) or `props` spread
   * straight onto an element. Every prop it did not name is read that way,
   * so none of them can be reported as unconsumed.
   */
  forwardsRemainingProps: boolean;
}

function isPropsExpression(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return node.text === 'props';
  return (
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.name.text === 'props'
  );
}

function hasRestElement(pattern: ts.ObjectBindingPattern): boolean {
  return pattern.elements.some((element) => element.dotDotDotToken !== undefined);
}

/** Collect direct property names and forwarding evidence from the executable AST. */
function analyseSource(text: string): SourceAnalysis {
  const sourceFile = ts.createSourceFile('prop-consumption.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const parameterBindings = new Set<string>();
  let forwardsRemainingProps = false;

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      const functionLike = node as ts.FunctionLikeDeclaration;
      if (functionLike.body) {
        for (const parameter of functionLike.parameters) {
          if (!ts.isObjectBindingPattern(parameter.name)) continue;
          if (hasRestElement(parameter.name)) forwardsRemainingProps = true;
          for (const element of parameter.name.elements) {
            if (element.dotDotDotToken) continue;
            const propertyName = element.propertyName ?? element.name;
            if (ts.isIdentifier(propertyName)) parameterBindings.add(propertyName.text);
          }
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      isPropsExpression(node.initializer) &&
      hasRestElement(node.name)
    ) {
      forwardsRemainingProps = true;
    }
    if (ts.isJsxSpreadAttribute(node) && isPropsExpression(node.expression)) {
      forwardsRemainingProps = true;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { parameterBindings, forwardsRemainingProps };
}

function analyseSources(sources: SourceFile[]): SourceAnalysis {
  const parameterBindings = new Set<string>();
  let forwardsRemainingProps = false;
  for (const source of sources) {
    const analysis = analyseSource(source.text);
    for (const binding of analysis.parameterBindings) parameterBindings.add(binding);
    forwardsRemainingProps ||= analysis.forwardsRemainingProps;
  }
  return { parameterBindings, forwardsRemainingProps };
}

function isPropConsumedInSources(name: string, sources: SourceFile[], analysis: SourceAnalysis): boolean {
  if (analysis.forwardsRemainingProps) return true;
  return sources.some(
    (source) =>
      hasMemberAccess(name, source.text) ||
      hasPropsDestructuring(name, source.text) ||
      analysis.parameterBindings.has(name) ||
      hasBareShorthand(name, source.text),
  );
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
  return isPropConsumedInSources(name, sources, analyseSources(sources));
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
  const analysis = analyseSources(readable);
  return propNames.filter((name) => name.length > 0 && !isPropConsumedInSources(name, readable, analysis));
}

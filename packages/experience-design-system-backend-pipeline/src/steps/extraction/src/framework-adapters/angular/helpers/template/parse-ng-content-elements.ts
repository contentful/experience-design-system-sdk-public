export interface NgContentElement {
  /** Raw `select=` attribute value (unquoted), or `null` when absent / bare `<ng-content>`. */
  rawSelect: string | null;
  /** 1-indexed line in the template where this `<ng-content>` was declared. */
  sourceLine: number;
}

/**
 * Find every `<ng-content>` tag in an Angular template. Returns the raw
 * `select=` attribute value (compound selectors like `"a, [b], .c"` stay as
 * one string — parsing happens in derive-slot-name).
 *
 * Uses a scoped regex rather than a full HTML parser because:
 *   - Angular templates contain `*ngIf`, `@if {}`, `{{ interpolations }}`,
 *     `[prop]="..."` bindings — any dumb HTML parser treats these as text/attr,
 *     but adds a dependency for a single tag type.
 *   - We only need one tag's name + one of its attributes.
 *
 * Handles the three ng-content forms seen in real DS code:
 *   <ng-content></ng-content>
 *   <ng-content />
 *   <ng-content select="header"></ng-content>
 */
export function parseNgContentElements(templateHtml: string): NgContentElement[] {
  const out: NgContentElement[] = [];
  // Match any <ng-content ...> tag (self-closing or open). Attribute block is lazy
  // so we don't accidentally span past the first `>`.
  const tagRe = /<ng-content\b([^>]*?)\/?>/gi;
  for (const match of templateHtml.matchAll(tagRe)) {
    const attrs = match[1] ?? '';
    const selectMatch = attrs.match(/\bselect\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    const rawSelect = selectMatch ? (selectMatch[1] ?? selectMatch[2] ?? null) : null;
    const sourceLine = countLines(templateHtml, match.index ?? 0);
    out.push({ rawSelect, sourceLine });
  }
  return out;
}

function countLines(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

export interface NgContentElement {
  rawSelect: string | null;

  sourceLine: number;
}

export function parseNgContentElements(templateHtml: string): NgContentElement[] {
  const out: NgContentElement[] = [];

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

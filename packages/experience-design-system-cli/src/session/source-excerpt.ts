/**
 * Bounded source excerpts that keep the lines that matter.
 *
 * Head truncation of a styles module keeps its imports and top-level
 * constants and drops the one line that decides a property's classification —
 * the place the value is interpolated into a style. An excerpt built from
 * windows around each property name's occurrences spends the same byte budget
 * on that line instead.
 */

const ELLIPSIS_MARKER = '/* … */';
const TRUNCATED_MARKER = '/* truncated */';

export interface SourceExcerpt {
  content: string;
  /**
   * Names with at least one occurrence that did not fit in `content`. The
   * reader cannot see that use, so its absence from the excerpt is a gap, not
   * evidence. Empty when every occurrence is shown.
   */
  usesNotShown: string[];
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function identifierPattern(name: string): RegExp {
  // Whole identifiers only: `padding` must not match `paddingTop`.
  return new RegExp(`(?<![A-Za-z0-9_$])${escapeForRegExp(name)}(?![A-Za-z0-9_$])`);
}

interface Window {
  start: number;
  end: number;
  names: Set<string>;
}

/**
 * Returns `text` whole when it fits `maxChars`. Otherwise returns windows of
 * `contextLines` lines around every line that mentions one of `names`, merged
 * where they overlap, in file order, until the budget is spent. With no
 * occurrences at all it falls back to the head of the file.
 */
export function excerptAroundNames(
  text: string,
  names: string[],
  maxChars: number,
  contextLines: number = 6,
): SourceExcerpt {
  if (text.length <= maxChars) return { content: text, usesNotShown: [] };

  const patterns = names.filter((name) => name.length > 0).map((name) => ({ name, pattern: identifierPattern(name) }));
  const lines = text.split('\n');

  const windows: Window[] = [];
  lines.forEach((line, index) => {
    const mentioned = patterns.filter(({ pattern }) => pattern.test(line)).map(({ name }) => name);
    if (mentioned.length === 0) return;
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);
    const last = windows[windows.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      for (const name of mentioned) last.names.add(name);
    } else {
      windows.push({ start, end, names: new Set(mentioned) });
    }
  });

  if (windows.length === 0) {
    return { content: `${text.slice(0, maxChars)}\n${TRUNCATED_MARKER}`, usesNotShown: [] };
  }

  // Select last-first: in a source file the declaration of a name comes
  // before its use (`fontColor?: ColorTokens` in the props interface, then
  // `color: tokens[fontColor]` in the style), and under a tight budget the use
  // is the line that decides classification. Render in file order afterwards.
  // A name is only reported as cut when the window holding its LAST occurrence
  // is dropped: that is the use site, and it is the line the reader needs. A
  // dropped declaration while the use is shown is not a gap worth reporting.
  const lastWindowFor = new Map<string, Window>();
  for (const window of windows) for (const name of window.names) lastWindowFor.set(name, window);

  const kept: Array<{ window: Window; text: string }> = [];
  const cut = new Set<string>();
  let used = 0;
  for (const window of [...windows].reverse()) {
    const chunk = lines.slice(window.start, window.end + 1).join('\n');
    const separator = kept.length > 0 ? `\n${ELLIPSIS_MARKER}\n` : '';
    if (used + separator.length + chunk.length > maxChars) {
      if (kept.length === 0) {
        // Even the first chosen window overflows: show as much of it as fits,
        // and report every name whose line was lost in the cut.
        const head = chunk.slice(0, maxChars);
        kept.push({ window, text: head });
        used += head.length;
        for (const name of window.names) {
          if (lastWindowFor.get(name) === window && !identifierPattern(name).test(head)) cut.add(name);
        }
        continue;
      }
      for (const name of window.names) {
        if (lastWindowFor.get(name) === window) cut.add(name);
      }
      continue;
    }
    kept.push({ window, text: chunk });
    used += separator.length + chunk.length;
  }
  kept.sort((a, b) => a.window.start - b.window.start);
  const parts = kept.map((entry, index) => (index > 0 ? `\n${ELLIPSIS_MARKER}\n` : '') + entry.text);

  const usesNotShown = names.filter((name, index) => cut.has(name) && names.indexOf(name) === index);
  return { content: `${parts.join('')}\n${TRUNCATED_MARKER}`, usesNotShown };
}

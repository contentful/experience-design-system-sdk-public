function appendLongWordChunks(word: string, width: number, lines: string[]): string {
  let rest = word;
  while (rest.length > width) {
    lines.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  return rest;
}

export function wrapText(text: string, innerWidth: number): string[] {
  if (!text) return [''];
  const width = Math.max(1, innerWidth);
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word.length > width ? appendLongWordChunks(word, width, lines) : word;
      continue;
    }

    if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word.length > width ? appendLongWordChunks(word, width, lines) : word;
    }
  }

  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

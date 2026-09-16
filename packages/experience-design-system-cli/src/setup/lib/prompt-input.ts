/**
 * A terminal coalesces fast input, so a pasted value and the Enter that follows
 * it arrive in a single chunk (`"my-token\r"`). Only the first line is kept, so
 * a multi-line paste submits its first value instead of filling one field with
 * all of them.
 */
export function splitPromptInput(input: string): { text: string; submitted: boolean } {
  const cleaned = stripBracketedPasteMarkers(input);
  const newlineIndex = cleaned.search(/[\r\n]/);
  if (newlineIndex === -1) return { text: stripControlCharacters(cleaned), submitted: false };
  return { text: stripControlCharacters(cleaned.slice(0, newlineIndex)), submitted: true };
}

/** Terminals wrap a paste in `ESC[200~` / `ESC[201~` when bracketed paste is on. */
function stripBracketedPasteMarkers(value: string): string {
  return value.replace(/\x1b\[20[01]~/g, '');
}

function stripControlCharacters(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, '');
}

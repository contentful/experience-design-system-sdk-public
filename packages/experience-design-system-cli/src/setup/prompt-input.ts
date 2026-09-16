/**
 * Split a raw terminal input chunk into typed text and whether it submits.
 *
 * A terminal coalesces fast input, so a pasted value and the Enter that follows
 * it can arrive in a single chunk (`"my-token\r"`). Treating such a chunk as
 * plain text would append the carriage return to the field instead of
 * submitting it, so the trailing newline is detected here. Only the first line
 * is kept: a multi-line paste submits its first value rather than smuggling the
 * remaining lines into one field.
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

/** Drop escape sequences and other control bytes a paste may carry along. */
function stripControlCharacters(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, '');
}

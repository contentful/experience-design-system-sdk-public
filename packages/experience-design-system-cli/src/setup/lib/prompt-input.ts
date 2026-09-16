/**
 * A terminal coalesces fast input, so a pasted value and the Enter that follows
 * it arrive in a single chunk (`"my-token\r"`). Only the first line is kept, so
 * a multi-line paste submits its first value instead of filling one field with
 * all of them.
 *
 * This is why setup reads raw chunks instead of using @inkjs/ui's TextInput.
 * Ink's `parseKeypress` reports `key.return` only for a bare `"\r"`, so a
 * coalesced chunk arrives as text with `key.return === false`; TextInput then
 * inserts the whole thing — trailing CR and all — and never submits. Verified
 * against @inkjs/ui 2 on Ink 5, where PasswordInput behaves the same way and
 * ConfirmInput ignores `"y\r"` outright.
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

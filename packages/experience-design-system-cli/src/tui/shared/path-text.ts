const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const CONTROL_CHARACTERS_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

const NAMED_ESCAPES: Record<string, string> = { '\r': '\\r', '\t': '\\t' };

export function stripControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS, '');
}

export function cleanPathText(text: string): string {
  return stripControlCharacters(text).trim();
}

export function printable(text: string): string {
  return text.replace(
    CONTROL_CHARACTERS_EXCEPT_NEWLINE,
    (char) => NAMED_ESCAPES[char] ?? `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
}

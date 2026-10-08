import type { ErrorDiagnostic, ParsedEdsiError } from './types.js';

/** Parses the "binding configurations are invalid" / "Pointer path does not exist" family of errors. */
export function parseBindingDiagnostics(body: string): Partial<ParsedEdsiError> | null {
  if (!/binding configurations are invalid|Pointer path does not exist/i.test(body)) return null;

  const locationMatches = [...body.matchAll(/(?:^|\.\s)([A-Za-z0-9_$-]+(?:\s*›\s*[A-Za-z0-9_$-]+){2,})/g)];
  const location = locationMatches.at(-1)?.[1];
  const pointerMessage = body.match(
    /Pointer path does not exist for '\[object Object\]':\s*(.+?)(?=\.\s*Default\s*›|$)/i,
  )?.[1];
  const graphQlMessage = body.match(/return GraphQL validation error:\s*(.+?)(?=\.\s*Default\s*›|$)/i)?.[1];
  const heading = body.match(/^(.*?)(?=\.?\s*Pointer path does not exist|\.?\s*Default\s*›)/i)?.[1]?.trim();

  const diagnostics: ErrorDiagnostic[] = [];
  if (pointerMessage) diagnostics.push({ message: pointerMessage.trim(), ...(location ? { path: location } : {}) });
  if (graphQlMessage) diagnostics.push({ message: graphQlMessage.trim(), ...(location ? { path: location } : {}) });

  return {
    code: 'BindingValidationFailed',
    message: heading || 'One or more binding configurations are invalid.',
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

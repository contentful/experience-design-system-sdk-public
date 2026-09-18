import { RELATIVE_IMPORT_PATTERN, TS_ESM_EXTENSION_REWRITES, IDENTIFIER_PATTERN } from './constants.js';
import { escapeForRegExp } from '../../session/source-excerpt.js';

// Candidate source paths for a specifier with an emitted extension, else [].
export function rewrittenSourcePaths(basePath: string): string[] {
  for (const [emitted, sources] of TS_ESM_EXTENSION_REWRITES) {
    if (!basePath.endsWith(emitted)) continue;
    const stem = basePath.slice(0, -emitted.length);
    return sources.map((ext) => `${stem}${ext}`);
  }
  return [];
}

export function identifiersIn(propTypes: string[]): string[] {
  const names = new Set<string>();
  for (const propType of propTypes) {
    for (const match of propType.matchAll(IDENTIFIER_PATTERN)) names.add(match[0]);
  }
  return [...names];
}

// Whether this file is where one of these names is declared, as opposed to a
// file that merely mentions it in a signature.
export function declaresAnyType(text: string, typeNames: string[]): boolean {
  return typeNames.some((name) =>
    new RegExp(`\\b(?:type|interface|enum|const|class)\\s+${escapeForRegExp(name)}\\b`).test(text),
  );
}

export function extractRelativeImportPaths(sourceText: string): string[] {
  const specifiers = new Set<string>();
  for (const match of sourceText.matchAll(RELATIVE_IMPORT_PATTERN)) {
    if (match[1]) specifiers.add(match[1]);
  }
  return [...specifiers];
}

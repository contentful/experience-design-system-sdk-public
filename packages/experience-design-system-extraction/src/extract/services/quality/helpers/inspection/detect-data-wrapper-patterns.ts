import type { RawComponentDefinition } from '../../../../types/component.js';
import { parseImportedNames } from '../../../../helpers/evidence/parse-source-imports.js';

export const DATA_WRAPPER_REASON_PREFIX = 'data-wrapper:';

const INFRA_PROP_NAMES = new Set(['id', 'locale', 'preview', 'slug', 'topic', 'previousComponent', '__typename']);

export const VISIBLE_UI_TAG_PATTERN =
  /<(?:[A-Z][A-Za-z0-9_.]*|div|span|section|main|article|header|footer|nav|aside|img|video|p|h[1-6]|ul|ol|li|button|input|textarea|select|form|label|table|tbody|thead|tr|td|th)\b/;

export const GENERATED_IMPORT_PATTERN = /from\s+['"][^'"]*__generated[^'"]*['"]/;
export const GENERATED_QUERY_HOOK_PATTERN = /\buse[A-Z][A-Za-z0-9]*(?:Lazy|Suspense)?Query\s*\(/;
export const GQL_FILENAME_PATTERN = /(?:-gql|-ggl)\.[cm]?[jt]sx?$/i;
export const LOADING_NULL_GUARD_PATTERN =
  /if\s*\([^)]*(?:isLoading|loading|!data|!\w+Collection|!\w+Item|!\w+)\s*[^)]*\)\s*return\s+null\b/;

const IMPORT_PATTERN = /import\s+(?:type\s+)?(.+?)\s+from\s+['"]([^'"]+)['"]/g;

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function collectSiblingRendererImports(sourceText: string): string[] {
  const names = new Set<string>();
  for (const match of sourceText.matchAll(IMPORT_PATTERN)) {
    const importClause = match[1]?.trim() ?? '';
    const importPath = match[2]?.trim() ?? '';
    if (!importPath.startsWith('./')) continue;
    if (importPath.includes('__generated')) continue;
    if (/-g(?:ql|gl)(?:$|\.)/i.test(importPath)) continue;
    for (const name of parseImportedNames(importClause)) {
      if (name) names.add(name);
    }
  }
  return [...names];
}

export function hasSiblingForwardRender(sourceText: string, siblingImports: string[]): boolean {
  return siblingImports.some((name) => {
    const renderPattern = new RegExp(`<${escapeRegExp(name)}\\b[\\s\\S]*?(?:/>|</${escapeRegExp(name)}>)`);
    if (!renderPattern.test(sourceText)) return false;
    const siblingSpreadPattern = new RegExp(`<${escapeRegExp(name)}\\b[^>]*\\{\\.\\.\\.(?!props\\b)[^}]+\\}`);
    const propsPlusSiblingSpreadPattern = new RegExp(
      `<${escapeRegExp(name)}\\b[^>]*\\{\\.\\.\\.props\\}[^>]*\\{\\.\\.\\.(?!props\\b)[^}]+\\}`,
    );
    return siblingSpreadPattern.test(sourceText) || propsPlusSiblingSpreadPattern.test(sourceText);
  });
}

export function hasVisibleUiRender(sourceText: string): boolean {
  return /return\s*(?:\(|<)/.test(sourceText) && VISIBLE_UI_TAG_PATTERN.test(sourceText);
}

/** Returns the prop names when all props are infra-only fetch props; returns empty array otherwise. */
export function collectInfraPropNames(component: RawComponentDefinition): string[] {
  const props = component.props.map((prop) => prop.name);
  return props.length > 0 && props.every((prop) => INFRA_PROP_NAMES.has(prop)) ? props : [];
}

/** Maps a raw wrapper evidence score (0–∞) to a 0–5 confidence value. */
export function mapScoreToWrapperConfidence(score: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (score <= 0) return 0;
  if (score <= 2) return 2;
  if (score <= 4) return 3;
  if (score <= 6) return 4;
  return 5;
}

export function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

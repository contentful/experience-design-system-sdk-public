import { readFile } from 'node:fs/promises';
import type { RawComponentDefinition } from '../../types.js';

export const HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON = 'data-fetch-wrapper';
export const POSSIBLE_DATA_FETCH_WRAPPER_REASON = 'possible-data-fetch-wrapper';
export const ZERO_SURFACE_RENDERED_UI_REASON = 'zero-surface:rendered-ui';

const DATA_WRAPPER_REASON_PREFIX = 'data-wrapper:';
const INFRA_PROP_NAMES = new Set(['id', 'locale', 'preview', 'slug', 'topic', 'previousComponent', '__typename']);
const VISIBLE_UI_TAG_PATTERN =
  /<(?:[A-Z][A-Za-z0-9_.]*|div|span|section|main|article|header|footer|nav|aside|img|video|p|h[1-6]|ul|ol|li|button|input|textarea|select|form|label|table|tbody|thead|tr|td|th)\b/;
const GENERATED_IMPORT_PATTERN = /from\s+['"][^'"]*__generated[^'"]*['"]/;
const GENERATED_QUERY_HOOK_PATTERN = /\buse[A-Z][A-Za-z0-9]*(?:Lazy|Suspense)?Query\s*\(/;
const GQL_FILENAME_PATTERN = /(?:-gql|-ggl)\.[cm]?[jt]sx?$/i;
const LOADING_NULL_GUARD_PATTERN =
  /if\s*\([^)]*(?:isLoading|loading|!data|!\w+Collection|!\w+Item|!\w+)\s*[^)]*\)\s*return\s+null\b/;
const IMPORT_PATTERN = /import\s+(?:type\s+)?(.+?)\s+from\s+['"]([^'"]+)['"]/g;

export interface ComponentSourceInspection {
  wrapperConfidence: 0 | 1 | 2 | 3 | 4 | 5;
  reviewReasons: string[];
  keepDespiteZeroSurface: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseImportedNames(importClause: string): string[] {
  const trimmed = importClause.trim();
  if (!trimmed) return [];

  const names: string[] = [];
  const defaultAndNamed = trimmed.split(',').map((part) => part.trim());

  for (const part of defaultAndNamed) {
    if (!part) continue;
    if (part.startsWith('{') && part.endsWith('}')) {
      for (const named of part
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        const [local] = named.split(/\s+as\s+/i);
        if (local) names.push(local.trim());
      }
      continue;
    }

    const [local] = part.split(/\s+as\s+/i);
    if (local) names.push(local.trim());
  }

  return names;
}

function collectSiblingRendererImports(sourceText: string): string[] {
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

function hasSiblingForwardRender(sourceText: string, siblingImports: string[]): boolean {
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

function hasVisibleUiRender(sourceText: string): boolean {
  return /return\s*(?:\(|<)/.test(sourceText) && VISIBLE_UI_TAG_PATTERN.test(sourceText);
}

function infraPropNames(component: RawComponentDefinition): string[] {
  const props = component.props.map((prop) => prop.name);
  return props.length > 0 && props.every((prop) => INFRA_PROP_NAMES.has(prop)) ? props : [];
}

function scoreToConfidence(score: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (score <= 0) return 0;
  if (score <= 2) return 2;
  if (score <= 4) return 3;
  if (score <= 6) return 4;
  return 5;
}

function dedupeReasons(reasons: string[]): string[] {
  return [...new Set(reasons)];
}

export async function inspectComponentSource(component: RawComponentDefinition): Promise<ComponentSourceInspection> {
  let sourceText = '';
  try {
    sourceText = await readFile(component.source, 'utf8');
  } catch {
    return {
      wrapperConfidence: 0,
      reviewReasons: [],
      keepDespiteZeroSurface: false,
    };
  }

  const reviewReasons: string[] = [];
  let wrapperScore = 0;

  const hasGeneratedQueryHook =
    GENERATED_IMPORT_PATTERN.test(sourceText) && GENERATED_QUERY_HOOK_PATTERN.test(sourceText);
  const infraProps = infraPropNames(component);
  const siblingImports = collectSiblingRendererImports(sourceText);

  if (GQL_FILENAME_PATTERN.test(component.source)) {
    reviewReasons.push('data-wrapper:gql-filename');
    wrapperScore += 1;
  }

  if (hasGeneratedQueryHook) {
    reviewReasons.push('data-wrapper:generated-query-hook');
    wrapperScore += 3;
  }

  // Require corroboration from a stronger signal before counting sibling imports —
  // otherwise any composed component that imports two sub-components scores +1 here.
  if (siblingImports.length > 0 && (hasGeneratedQueryHook || infraProps.length > 0)) {
    reviewReasons.push('data-wrapper:sibling-renderer-import');
    wrapperScore += 1;
  }

  if (hasSiblingForwardRender(sourceText, siblingImports)) {
    reviewReasons.push('data-wrapper:fetch-forward-render');
    wrapperScore += 3;
  }

  if (sourceText.includes('useContentfulLiveUpdates(') || sourceText.includes('useContentfulContext(')) {
    reviewReasons.push('data-wrapper:contentful-runtime');
    wrapperScore += 1;
  }

  if (infraProps.length > 0) {
    reviewReasons.push('data-wrapper:infra-props');
    wrapperScore += 2;
  }

  if (LOADING_NULL_GUARD_PATTERN.test(sourceText)) {
    reviewReasons.push('data-wrapper:loading-null-guard');
    wrapperScore += 1;
  }

  const wrapperConfidence = scoreToConfidence(wrapperScore);
  if (wrapperConfidence >= 4) {
    reviewReasons.unshift(HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON);
  } else if (wrapperConfidence === 3) {
    reviewReasons.unshift(POSSIBLE_DATA_FETCH_WRAPPER_REASON);
  }

  const keepDespiteZeroSurface =
    component.props.length === 0 && component.slots.length === 0 && hasVisibleUiRender(sourceText);

  if (keepDespiteZeroSurface) {
    reviewReasons.push(ZERO_SURFACE_RENDERED_UI_REASON);
  }

  return {
    wrapperConfidence,
    reviewReasons: dedupeReasons(reviewReasons),
    keepDespiteZeroSurface,
  };
}

export function isDataWrapperReviewReason(reason: string): boolean {
  return (
    reason === HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON ||
    reason === POSSIBLE_DATA_FETCH_WRAPPER_REASON ||
    reason.startsWith(DATA_WRAPPER_REASON_PREFIX)
  );
}

export function describeReviewReason(reason: string): string {
  switch (reason) {
    case HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON:
      return 'high-confidence data-fetch wrapper';
    case POSSIBLE_DATA_FETCH_WRAPPER_REASON:
      return 'possible data-fetch wrapper';
    case 'data-wrapper:gql-filename':
      return 'source file follows a gql wrapper naming pattern';
    case 'data-wrapper:generated-query-hook':
      return 'imports and calls a generated query hook';
    case 'data-wrapper:sibling-renderer-import':
      return 'imports a sibling renderer from the same folder';
    case 'data-wrapper:fetch-forward-render':
      return 'forwards fetched data into a sibling renderer';
    case 'data-wrapper:contentful-runtime':
      return 'uses Contentful runtime hooks';
    case 'data-wrapper:infra-props':
      return 'only exposes infra-fetch props';
    case 'data-wrapper:loading-null-guard':
      return 'returns early while loading or when fetched data is missing';
    case ZERO_SURFACE_RENDERED_UI_REASON:
      return 'source renders visible/compositional UI despite zero extracted props and slots';
    default:
      return reason;
  }
}

export function describeReviewReasons(reasons: string[]): string[] {
  return dedupeReasons(reasons.map(describeReviewReason));
}

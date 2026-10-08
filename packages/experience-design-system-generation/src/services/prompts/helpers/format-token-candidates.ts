import { flattenDTCG } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import type { GeneratedCdf } from '../../../types/prompt.js';

export function inferFenceLang(filename: string | undefined): string {
  if (!filename) return 'json';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    js: 'js',
    mjs: 'js',
    cjs: 'js',
    ts: 'ts',
    mts: 'ts',
    cts: 'ts',
    tsx: 'tsx',
    jsx: 'jsx',
    vue: 'vue',
    svelte: 'svelte',
    astro: 'astro',
    scss: 'scss',
    sass: 'scss',
    css: 'css',
    json: 'json',
    json5: 'json',
  };
  return map[ext] ?? 'text';
}

export function filterDesignTokenProps(cdf: GeneratedCdf): {
  filtered: GeneratedCdf;
  kinds: string[];
  hasUnscoped: boolean;
} {
  const result: GeneratedCdf = {};
  const kinds = new Set<string>();
  let hasUnscoped = false;
  for (const [componentName, component] of Object.entries(cdf)) {
    const properties = component.$properties;
    if (!properties) continue;
    const filteredProps: Record<string, CDFComponentEntry['$properties'][string]> = {};
    for (const [propName, prop] of Object.entries(properties)) {
      if (prop.$type === 'token' && prop.$category === 'design') {
        const { '$token.allowed': _tokenAllowed, ...rest } = prop;
        filteredProps[propName] = rest;
        const kind = prop['$token.kind'];
        if (typeof kind === 'string' && kind.length > 0) {
          kinds.add(kind);
        } else {
          hasUnscoped = true;
        }
      }
    }
    if (Object.keys(filteredProps).length > 0) {
      result[componentName] = { ...component, $properties: filteredProps };
    }
  }
  return { filtered: result, kinds: [...kinds].sort(), hasUnscoped };
}

export function buildTokenCandidateSections(
  tokenTree: Record<string, unknown>,
  filteredTokenProps?: ReturnType<typeof filterDesignTokenProps>,
): string[] {
  const index = flattenDTCG(tokenTree, '').sort((a, b) => a.path.localeCompare(b.path));
  if (index.length === 0) return [];

  const sections: string[] = [];
  const renderSection = (kind: string | null, entries: Array<{ path: string; $type?: unknown }>): string => {
    const label = kind
      ? `Token path index — ${kind} candidates only`
      : 'Token path index — full tree (no $token.kind to scope by)';
    const lines = entries.map((e) => `${e.path} · ${e.$type}`).join('\n');
    return `${label}, one leaf token per line as \`path · type\`, no \`$value\`:\n${lines}`;
  };

  if (filteredTokenProps) {
    const { kinds, hasUnscoped } = filteredTokenProps;
    for (const kind of kinds) {
      const scoped = index.filter((e) => e.$type === kind);
      if (scoped.length > 0) sections.push(renderSection(kind, scoped));
    }
    if (hasUnscoped) sections.push(renderSection(null, index));
  } else {
    sections.push(renderSection(null, index));
  }
  return sections;
}

import { flattenDTCG, type CDFComponentEntry } from '@contentful/experience-design-system-types';
import type { GeneratedCdf, PromptOptions } from '../model/prompt.js';

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

/**
 * Keeps only design-category, token-typed props per component (dropping
 * components left with none), alongside the distinct `$token.kind` values
 * seen among them and whether any such prop has no `$token.kind` at all —
 * collected in the same pass rather than a second walk of the raw CDF.
 */
function filterDesignTokenProps(cdf: GeneratedCdf): {
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

/** One line per candidate, e.g. `colors.brand.primary · color` — legible and countable, unlike nested JSON. */
function formatTokenCandidateLines(entries: Array<{ path: string; $type?: unknown }>): string {
  return entries.map((entry) => `${entry.path} · ${entry.$type}`).join('\n');
}

/** Renders one kind-scoped (or, for `kind: null`, full-tree) candidate section. Sections are cumulative, never merged, so each stays independently legible. */
function renderTokenCandidateSection(kind: string | null, entries: Array<{ path: string; $type?: unknown }>): string {
  const label = kind
    ? `Token path index — ${kind} candidates only`
    : 'Token path index — full tree (no $token.kind to scope by)';
  return `${label}, one leaf token per line as \`path · type\`, no \`$value\`:\n${formatTokenCandidateLines(entries)}`;
}

export function renderPromptContext(options: PromptOptions): string {
  const {
    skill,
    rawComponentsInline,
    rawTokensInline,
    rawTokensFilename,
    tokensInline,
    tokenMapInline,
    generatedCdf,
    tokenTree,
    componentSourceRefs,
    existingComponentsInline,
    existingTokensInline,
    componentAllowlistInline,
  } = options;

  const sections: string[] = [];

  if (existingComponentsInline) {
    sections.push(
      `Existing components in the target Contentful space (JSON) — use for alignment, not as a hard filter:\n\`\`\`json\n${existingComponentsInline}\n\`\`\``,
    );
  }
  if (existingTokensInline) {
    sections.push(
      `Existing design tokens in the target Contentful space (JSON) — prefer binding to these paths over inventing new ones:\n\`\`\`json\n${existingTokensInline}\n\`\`\``,
    );
  }
  if (componentAllowlistInline) {
    sections.push(
      `Known component names for slot allowed_components (hard allowlist; never use any other name). Never invent a child from an import, JSX element, type name, icon name, or implementation helper.\n\`\`\`json\n${componentAllowlistInline}\n\`\`\``,
    );
  }
  if (rawComponentsInline) {
    sections.push(`Raw component data (JSON):\n\`\`\`json\n${rawComponentsInline}\n\`\`\``);
  }
  if (rawTokensInline) {
    const lang = inferFenceLang(rawTokensFilename);
    const label = rawTokensFilename ? `Raw token source (${rawTokensFilename})` : 'Raw token source';
    sections.push(`${label}:\n\`\`\`${lang}\n${rawTokensInline}\n\`\`\``);
  }
  if (tokensInline) {
    sections.push(`DTCG token data (for token kind lookups):\n\`\`\`json\n${tokensInline}\n\`\`\``);
  }
  if (tokenMapInline) {
    sections.push(`Token-name sidecar (raw name → DTCG path):\n\`\`\`json\n${tokenMapInline}\n\`\`\``);
  }
  const filteredTokenProps = generatedCdf ? filterDesignTokenProps(generatedCdf) : undefined;
  if (filteredTokenProps && Object.keys(filteredTokenProps.filtered).length > 0) {
    sections.push(
      `Generated CDF so far — design-category token props only (JSON):\n\`\`\`json\n${JSON.stringify(filteredTokenProps.filtered)}\n\`\`\``,
    );
  }
  if (tokenTree) {
    const index = flattenDTCG(tokenTree, '').sort((a, b) => a.path.localeCompare(b.path));
    if (index.length > 0) {
      if (filteredTokenProps) {
        const { kinds, hasUnscoped } = filteredTokenProps;
        for (const kind of kinds) {
          const scoped = index.filter((entry) => entry.$type === kind);
          if (scoped.length > 0) sections.push(renderTokenCandidateSection(kind, scoped));
        }
        if (hasUnscoped) sections.push(renderTokenCandidateSection(null, index));
      } else {
        sections.push(renderTokenCandidateSection(null, index));
      }
    }
  }
  if (componentSourceRefs && componentSourceRefs.length > 0) {
    const withContent = componentSourceRefs.filter((ref) => ref.content != null);
    const withoutContent = componentSourceRefs.filter((ref) => ref.content == null);
    if (withContent.length > 0) {
      const blocks = withContent.map((ref) => {
        const mainBlock = `#### ${ref.component} (\`${ref.sourcePath}\`)\n\`\`\`${inferFenceLang(ref.sourcePath)}\n${ref.content}\n\`\`\``;
        const siblingBlocks = (ref.siblingFiles ?? []).map(
          (sibling) =>
            `##### ${ref.component} — imported file \`${sibling.path}\`\n\`\`\`${inferFenceLang(sibling.path)}\n${sibling.content}\n\`\`\``,
        );
        const truncationNote =
          ref.truncatedSiblingCount && ref.truncatedSiblingCount > 0
            ? [
                `##### ${ref.component} — +${ref.truncatedSiblingCount} more imported file${ref.truncatedSiblingCount === 1 ? '' : 's'} not shown (evidence may be incomplete)`,
              ]
            : [];
        const notShownNote =
          ref.usesNotShown && ref.usesNotShown.length > 0
            ? [
                `##### ${ref.component} — uses not shown: ${ref.usesNotShown.join(', ')}\n\nThe files above are excerpts, and each of these properties has at least one use that fell outside the excerpt budget. Treat their consumption as unknown, not absent: do not classify them \`token\` on what is shown, and do not conclude they are unread.`,
              ]
            : [];
        return [mainBlock, ...siblingBlocks, ...truncationNote, ...notShownNote].join('\n\n');
      });
      sections.push(`### Component source references\n\n${blocks.join('\n\n')}`);
    }
    if (withoutContent.length > 0) {
      const guidance =
        skill === 'components'
          ? 'there is no consumption evidence for these, so `token` cannot be earned for any of their props — classify from the prop signature alone, and any prop that would otherwise be enum-versus-token is `enum` (or `string`)'
          : 'there is no source evidence to narrow from — emit nothing for their props';
      sections.push(
        `Component source unavailable for (JSON) — ${guidance}:\n\`\`\`json\n${JSON.stringify(withoutContent.map((ref) => ({ component: ref.component, sourcePath: ref.sourcePath })))}\n\`\`\``,
      );
    }
  }

  return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
}

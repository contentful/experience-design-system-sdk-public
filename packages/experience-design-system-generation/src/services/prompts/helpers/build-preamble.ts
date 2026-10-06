import type { PromptOptions } from '../../../types/prompt.js';
import { inferFenceLang, filterDesignTokenProps, buildTokenCandidateSections } from './format-token-candidates.js';
import { formatSourceRefsSection } from './format-source-refs.js';
import {
  buildComponentsAutonomousPreamble,
  buildSelectAutonomousPreamble,
  buildMapTokensAutonomousPreamble,
  buildTokensAutonomousPreamble,
} from './build-skill-preambles.js';

export function buildPreamble(options: PromptOptions): string {
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
      `Known component names for slot allowed_components (hard allowlist; never use any other name):\n\`\`\`json\n${componentAllowlistInline}\n\`\`\``,
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
    sections.push(...buildTokenCandidateSections(tokenTree, filteredTokenProps));
  }
  if (componentSourceRefs && componentSourceRefs.length > 0) {
    sections.push(...formatSourceRefsSection(componentSourceRefs, skill));
  }

  const inputBlock = sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';

  if (skill === 'components') return buildComponentsAutonomousPreamble(inputBlock);
  if (skill === 'select') return buildSelectAutonomousPreamble(inputBlock);
  if (skill === 'map-tokens') return buildMapTokensAutonomousPreamble(inputBlock);
  return buildTokensAutonomousPreamble(inputBlock);
}

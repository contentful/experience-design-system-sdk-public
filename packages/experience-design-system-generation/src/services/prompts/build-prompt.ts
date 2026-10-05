import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PromptOptions, Skill } from '../../types/prompt.js';
import {
  inferFenceLang,
  filterDesignTokenProps,
  buildTokenCandidateSections,
} from './helpers/format-token-candidates.js';
import {
  buildComponentsAutonomousPreamble,
  buildSelectAutonomousPreamble,
  buildMapTokensAutonomousPreamble,
  buildTokensAutonomousPreamble,
} from './helpers/build-skill-preambles.js';

const SKILL_FILES: Record<Skill, string> = {
  components: 'generate-components.md',
  tokens: 'generate-tokens.md',
  select: 'select-components.md',
  'map-tokens': 'map-tokens.md',
};

export function resolveSkillPath(skill: Skill): string {
  if (!(skill in SKILL_FILES)) throw new Error(`Invalid skill: ${skill}`);
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let dir = thisDir;
  for (;;) {
    const candidate = join(dir, 'skills');
    if (existsSync(candidate)) return join(candidate, SKILL_FILES[skill]);
    const parent = resolve(dir, '..');
    if (parent === dir) {
      throw new Error(`skill file missing from CLI installation (could not locate skills/ directory from: ${thisDir})`);
    }
    dir = parent;
  }
}

export function formatCustomPromptBanner(skill: 'components' | 'select', path: string): string {
  return (
    `WARNING: Custom prompt active for ${skill}: ${path}\n` +
    `  Bundled invariants (utility-wrapper rejection, description content rules) do NOT apply.\n` +
    `  You are responsible for the prompt's correctness.\n`
  );
}

async function readSkillFile(skill: Skill, override?: string): Promise<string> {
  if (override) {
    const skillPath = resolve(override);
    try {
      return await readFile(skillPath, 'utf8');
    } catch {
      throw new Error(`custom prompt file not found (skill: ${skill}, path: ${skillPath})`);
    }
  }
  const skillPath = resolveSkillPath(skill);
  try {
    return await readFile(skillPath, 'utf8');
  } catch {
    throw new Error(`skill file missing from CLI installation — try reinstalling the CLI (looked for: ${skillPath})`);
  }
}

function buildPreamble(options: PromptOptions): string {
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
    for (const section of buildTokenCandidateSections(tokenTree, filteredTokenProps)) {
      sections.push(section);
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

  const inputBlock = sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';

  if (skill === 'components') return buildComponentsAutonomousPreamble(inputBlock);
  if (skill === 'select') return buildSelectAutonomousPreamble(inputBlock);
  if (skill === 'map-tokens') return buildMapTokensAutonomousPreamble(inputBlock);
  return buildTokensAutonomousPreamble(inputBlock);
}

export async function buildPrompt(options: PromptOptions): Promise<string> {
  const skillContent = options.skillContentOverride ?? (await readSkillFile(options.skill, options.skillPathOverride));
  const preamble = buildPreamble(options);
  return `${preamble}\n\nSkill instructions follow:\n---\n${skillContent}`;
}

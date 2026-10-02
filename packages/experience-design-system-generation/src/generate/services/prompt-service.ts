import type { PromptOptions, Skill } from '../model/prompt.js';
import {
  buildComponentsAutonomousPreamble,
  buildMapTokensAutonomousPreamble,
  buildSelectAutonomousPreamble,
  buildTokensAutonomousPreamble,
} from './preambles/index.js';
import { renderPromptContext } from './prompt-context-service.js';
import { loadSkillContent } from './skill-loader.js';

/**
 * Render the warning banner shown when a custom skill prompt is active.
 * Always cites the bundled invariants that the override bypasses so the
 * operator cannot miss it.
 */
export function formatCustomPromptBanner(skill: 'components' | 'select', path: string): string {
  return (
    `WARNING: Custom prompt active for ${skill}: ${path}\n` +
    `  Bundled invariants (utility-wrapper rejection, description content rules) do NOT apply.\n` +
    `  You are responsible for the prompt's correctness.\n`
  );
}

export async function buildPrompt(options: PromptOptions): Promise<string> {
  const skillContent =
    options.skillContentOverride ?? (await loadSkillContent(options.skill, options.skillPathOverride));
  const preamble = buildPreamble(options);
  return `${preamble}\n\nSkill instructions follow:\n---\n${skillContent}`;
}

function buildPreamble(options: PromptOptions): string {
  const inputBlock = renderPromptContext(options);

  switch (options.skill) {
    case 'components':
      return buildComponentsAutonomousPreamble(inputBlock);
    case 'select':
      return buildSelectAutonomousPreamble(inputBlock);
    case 'map-tokens':
      return buildMapTokensAutonomousPreamble(inputBlock);
    case 'tokens':
      return buildTokensAutonomousPreamble(inputBlock);
    default:
      return buildTokensAutonomousPreamble(inputBlock);
  }
}

export type { Skill };

import type { ExperiencesCredentials } from '../../../credentials-store.js';
import { emit, type SetupActionDependencies } from '../../lib/types.js';

export const CUSTOM_PROMPTS_HELP =
  'Replaces the built-in instructions the coding agent follows when it selects and generates components.';

/**
 * Ask for one custom prompt path. Returns the trimmed path, `undefined` to leave
 * the stored value alone, or `null` to clear it.
 */
export async function promptCustomSkillPathAction(
  kind: 'select' | 'generate',
  current: string | undefined,
  ask: SetupActionDependencies['ask'],
): Promise<string | undefined | null> {
  const label = kind === 'select' ? 'select (analyze select-agent)' : 'generate (generate components)';
  const answer = await ask(
    `Custom ${label} prompt path${current ? ` [${current}]` : ' [none]'} (empty=keep, "-"=clear): `,
  );
  const trimmed = answer.trim();
  return trimmed === '' ? undefined : trimmed === '-' ? null : trimmed;
}

export async function configureCustomPrompts(dependencies: SetupActionDependencies): Promise<void> {
  emit(dependencies, 'page', CUSTOM_PROMPTS_HELP);
  if (!(await dependencies.confirm('Use your own prompt files instead of the built-in ones?', false))) return;

  const stored = await dependencies.readCredentials();
  const selectPromptPath = await promptCustomSkillPathAction('select', stored.selectPromptPath, dependencies.ask);
  const generatePromptPath = await promptCustomSkillPathAction('generate', stored.generatePromptPath, dependencies.ask);

  const updated: ExperiencesCredentials = { ...stored };
  if (selectPromptPath === null) delete updated.selectPromptPath;
  else if (selectPromptPath !== undefined) updated.selectPromptPath = selectPromptPath;
  if (generatePromptPath === null) delete updated.generatePromptPath;
  else if (generatePromptPath !== undefined) updated.generatePromptPath = generatePromptPath;

  await dependencies.writeCredentials(updated);
}

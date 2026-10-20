import type { ImportTarget } from '../00-preflight/logic.js';

interface QuitKey {
  escape: boolean;
}

interface OverviewStep {
  description: string;
  /** Whether the step uses the user's local AI agent. */
  ai: boolean;
}

/** The steps the user is about to go through, as the welcome screen lists them, for what they chose to generate. */
export function overviewFor(target: ImportTarget): readonly OverviewStep[] {
  const push = { description: 'Push to Contentful', ai: false };
  if (target === 'tokens') return [{ description: 'Generate design tokens from your token file', ai: true }, push];
  const components: readonly OverviewStep[] = [
    {
      description:
        target === 'both' ? 'Extract components and generate tokens' : 'Extract components from your codebase',
      ai: true,
    },
    { description: 'Review what was extracted', ai: false },
    { description: 'Generate component definitions', ai: true },
    { description: 'Review generated definitions', ai: false },
  ];
  return [...components, push];
}

export function shouldQuit(key: QuitKey): boolean {
  return key.escape;
}

export function toProjectPath(value: string): string | null {
  const projectPath = value.trim();
  return projectPath === '' ? null : projectPath;
}

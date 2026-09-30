/** One line of the "what happens next" overview shown under the greeting. */
export interface WelcomeOverviewItem {
  label: string;
  description: string;
}

export const WELCOME_OVERVIEW: readonly WelcomeOverviewItem[] = [
  { label: 'Step 1', description: 'Extract components from your codebase' },
  { label: 'Step 2', description: 'Review what was extracted' },
  { label: 'Step 3', description: 'Generate CDF definitions with Claude' },
  { label: 'Step 4', description: 'Review generated definitions' },
  { label: 'Step 5', description: 'Push to Contentful' },
];

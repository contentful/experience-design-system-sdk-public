import type { WizardAppProps } from '../import/tui/WizardApp.js';

export async function launchWizard(props: WizardAppProps): Promise<void> {
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { WizardApp } = await import('../import/tui/WizardApp.js');
  const { waitUntilExit } = render(createElement<WizardAppProps>(WizardApp, props));
  await waitUntilExit();
}

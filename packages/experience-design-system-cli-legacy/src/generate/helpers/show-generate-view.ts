import { createElement } from 'react';
import { renderWithGoodbye } from '../../tui/render-with-goodbye.js';
import { exitWithAnalytics } from '../../analytics/index.js';
import { GenerateView } from '../tui/GenerateView.js';
import type { GenerateViewResult } from '../tui/GenerateView.js';

export async function showGenerateView(result: GenerateViewResult): Promise<void> {
  if (process.stdout.isTTY) {
    const { waitUntilExit } = renderWithGoodbye(
      createElement(GenerateView, {
        result,
        onExit: () => void exitWithAnalytics(0),
      }),
    );
    await waitUntilExit();
    return;
  }
  process.stdout.write(
    `generate complete\nskill: ${result.skill}\nagent: ${result.agent}\nsession=${result.sessionId}\n`,
  );
  await exitWithAnalytics(0);
}

import { createElement } from 'react';
import { renderWithGoodbye } from '../../tui/render-with-goodbye.js';
import { exitWithAnalytics } from '../../analytics/index.js';
import { MapTokensView } from '../tui/MapTokensView.js';
import type { MapTokensViewResult } from '../tui/MapTokensView.js';

export async function renderMapTokensResult(result: MapTokensViewResult): Promise<void> {
  if (process.stdout.isTTY) {
    const { waitUntilExit } = renderWithGoodbye(
      createElement(MapTokensView, { result, onExit: () => void exitWithAnalytics(0) }),
    );
    await waitUntilExit();
  } else {
    const summary = result.cached ? 'cached' : `${result.applied} mapping(s) applied`;
    process.stdout.write(`map tokens complete\nagent: ${result.agent}\nsession=${result.sessionId}\n${summary}\n`);
    await exitWithAnalytics(0);
  }
}

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { TokenReviewScreen } from '../../../../../src/tui/import/steps/05-token-review/screen.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

function tokensFile(contents: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'token-review-')), 'tokens.json');
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe('TokenReviewScreen', () => {
  it('lists the tokens and continues on Enter', async () => {
    const onContinue = vi.fn();
    const path = tokensFile({ color: { $type: 'color', primary: { $value: '#0059c8' } } });
    const { lastFrame, stdin } = render(
      <TokenReviewScreen tokensPath={path} onContinue={onContinue} onQuit={vi.fn()} />,
    );
    expect(lastFrame()).toContain('1 token generated');
    expect(lastFrame()).toContain('color.primary');
    expect(lastFrame()).toContain('#0059c8');
    await tick();
    stdin.write('\r');
    await tick();
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('shows the read error when the file is missing', () => {
    const { lastFrame } = render(
      <TokenReviewScreen tokensPath="/nonexistent/tokens.json" onContinue={vi.fn()} onQuit={vi.fn()} />,
    );
    expect(lastFrame()).toContain('Could not read the generated tokens');
  });
});

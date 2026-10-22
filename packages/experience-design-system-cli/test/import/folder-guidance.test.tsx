import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WelcomeScreen } from '../../src/tui/import/steps/01-welcome/screen.js';
import { PathValidationScreen } from '../../src/tui/import/steps/03-path-validation/screen.js';
import { describeFailure } from '../../src/tui/import/steps/03-path-validation/logic.js';
import { ScopeGateScreen } from '../../src/tui/import/steps/07-scope-gate/screen.js';
import { isAiFlagged } from '../../src/tui/import/steps/07-scope-gate/sidebar/ai-flag.js';
import { createDecisionState, partitionDecisions } from '../../src/tui/import/steps/07-scope-gate/state.js';
import type { ScopeComponent } from '../../src/tui/import/steps/07-scope-gate/types.js';

const views: ReturnType<typeof render>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.unmount();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));

describe('source folder guidance', () => {
  it('supports application and component folders while preserving path submission', async () => {
    const onContinue = vi.fn();
    const view = render(<WelcomeScreen initialPath="./example-app/src" onContinue={onContinue} onQuit={vi.fn()} />);
    views.push(view);
    expect(view.lastFrame()).toContain('Which source folder');
    expect(view.lastFrame()).toContain('application root');
    expect(view.lastFrame()).toContain('single component');
    await pause();
    view.stdin.write('\r');
    await vi.waitFor(() => expect(onContinue).toHaveBeenCalledWith('./example-app/src'));
  });

  it('offers directory choices when given a file without enabling file import', () => {
    expect(describeFailure('is-file', 'example.tsx')).toEqual({
      headline: "That's a file, not a directory.",
      hints: [
        'Choose an application root, a folder of components, or a folder containing a single component.',
        'Example: ~/projects/my-app/src',
      ],
    });
  });

  it('shows advisory dependency/content guidance without changing directory confirmation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'folder-guidance-'));
    directories.push(directory);
    const source = join(directory, 'Surface.tsx');
    writeFileSync(source, 'export const Surface = () => <section />;');
    const onConfirm = vi.fn();
    const view = render(
      <PathValidationScreen
        projectPath={directory}
        onConfirm={onConfirm}
        onChangePath={vi.fn()}
        onBack={vi.fn()}
        hasTokens={false}
      />,
    );
    views.push(view);
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Does this look right?'));
    expect(view.lastFrame()).toContain('File counts do not establish');
    expect(view.lastFrame()).toContain('evidence gaps');
    expect(view.lastFrame()).toContain('useful design, placement or composition');
    await pause();
    view.stdin.write('\r');
    await vi.waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ projectPath: directory, filePaths: [source] })),
    );
  });

  it('shows notes for accepted components without flagging them or changing saved selection', async () => {
    const component: ScopeComponent = {
      name: 'Surface',
      componentId: 'surface-source',
      aiDecision: 'accepted',
      needsReview: false,
      slots: [],
      modelingNotes: ['Provider use is unresolved; review project setup.'],
    };
    const savedDecisions = { accepted: ['Surface'], rejected: [] };
    expect(isAiFlagged(component)).toBe(false);
    expect(partitionDecisions([component], createDecisionState([component], savedDecisions))).toMatchObject(
      savedDecisions,
    );
    const onConfirm = vi.fn();
    const view = render(
      <ScopeGateScreen
        components={[component]}
        savedDecisions={savedDecisions}
        onConfirm={onConfirm}
        onQuit={vi.fn()}
      />,
    );
    views.push(view);
    expect(view.lastFrame()).toContain('Source guidance is advisory');
    expect(view.lastFrame()).not.toContain('flagged by AI');
    await pause();
    view.stdin.write('x');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Review notes (1)'));
    expect(view.lastFrame()).toContain('Provider use is unresolved');
    view.stdin.write('x');
    await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Review notes (1)'));
    view.stdin.write('f');
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining(savedDecisions)));
  });
});

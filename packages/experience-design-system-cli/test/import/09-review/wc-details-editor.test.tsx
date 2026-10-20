import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { extractComponents, type ComponentReviewMetadata } from '@contentful/experience-design-system-backend-pipeline';
import { ReviewDetailsEditor } from '../../../src/tui/import/steps/09-review/components/ReviewDetailsEditor.js';

let directory: string | undefined;
let metadata: ComponentReviewMetadata;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'wc-editor-'));
  const file = join(directory, 'Example.ts');
  writeFileSync(
    file,
    `class Example extends HTMLElement {@property({type:Number,attribute:'data-label',reflect:false}) label=0;} customElements.define('example-component',Example);`,
  );
  const component = (await extractComponents({ filePaths: [file], projectRoot: directory })).components[0]!;
  const candidate = component.sourceCandidates![0]!;
  metadata = {
    sourcePath: file,
    componentSource: 'CAPTURED_SOURCE_SNAPSHOT',
    sourceEvidenceReadStatus: 'available',
    sourceCandidates: component.sourceCandidates!,
    sourceCandidateSources: null,
    sourceCoverage: 'unavailable',
    extractionByteBinding: 'unverified',
    sourceTextHash: null,
    sourceLineRanges: [],
    scopeProvenance: null,
    props: { label: { sourceCandidate: candidate, rationale: null, sourceStartLine: null, sourceEndLine: null } },
    extractionDiagnostics: { status: 'absent' },
  };
});

afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it('makes saved syntax observations accessible through the actual review editor and source panel adapters', async () => {
  const before = JSON.stringify(metadata);
  const value = JSON.stringify({
    $type: 'component',
    $properties: { label: { $type: 'number', $category: 'content', $default: 0 } },
  });
  const props = {
    selectedKey: 'Example',
    componentRationale: null,
    reviewMetadata: metadata,
    width: 200,
    height: 120,
    jsonValue: value,
    sidebarFocused: false,
    reviewEditor: {
      panelOpen: 'source' as const,
      panelScrollOffset: 0,
      tokenReviewRow: 0,
      tokenReviewEditing: false,
      tokenReviewEditCursor: 0,
      tokenReviewEditSelection: new Set<string>(),
      showJson: false,
      jsonScrollOffset: 0,
      currentTokenSuggestions: () => [],
    },
    fieldEditor: { value, onChange: () => {}, onSave: () => {}, onDiscard: () => {} },
  };
  const view = render(<ReviewDetailsEditor {...props} />);
  try {
    expect(view.lastFrame()).toContain('data-label');
    expect(view.lastFrame()).toContain('converter');
    expect(view.lastFrame()).toContain('reflect');
    expect(view.lastFrame()).toContain('CAPTURED_SOURCE_SNAPSHOT');
    expect(view.lastFrame()).toContain('[s/Esc] close');
    view.rerender(<ReviewDetailsEditor {...props} height={14} width={80} />);
    expect(view.lastFrame()).toContain('CAPTURED_SOURCE_SNAPSHOT');
    const frames = [];
    for (let offset = 0; offset < 30; offset++) {
      view.rerender(
        <ReviewDetailsEditor
          {...props}
          height={14}
          width={80}
          reviewEditor={{ ...props.reviewEditor, panelScrollOffset: offset }}
        />,
      );
      frames.push(view.lastFrame());
      expect(view.lastFrame()).toContain('[s/Esc] close');
    }
    expect(frames.join('\n')).toContain('data-label');
    expect(frames.join('\n')).toContain('reflect');
    expect(frames.join('\n')).toContain('declaration:');
  } finally {
    view.unmount();
  }
  const editor = render(<ReviewDetailsEditor {...props} reviewEditor={{ ...props.reviewEditor, panelOpen: 'none' }} />);
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    editor.stdin.write('s');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(editor.lastFrame()).toContain('data-label');
    expect(editor.lastFrame()).toContain('converter');
  } finally {
    editor.unmount();
  }
  let changed = '';
  const editing = render(
    <ReviewDetailsEditor
      {...props}
      reviewEditor={{ ...props.reviewEditor, panelOpen: 'none' }}
      fieldEditor={{
        ...props.fieldEditor,
        initialFocusTarget: { kind: 'description' },
        onChange: (next) => {
          changed = next;
        },
      }}
    />,
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    editing.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 30));
    editing.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 30));
    editing.stdin.write('X');
    await new Promise((resolve) => setTimeout(resolve, 30));
    editing.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(JSON.parse(changed).$description).toBe('X');
  } finally {
    editing.unmount();
  }
  expect(JSON.stringify(metadata)).toBe(before);
});

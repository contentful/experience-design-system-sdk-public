import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { expect, it } from 'vitest';
import { extractComponents, type ComponentReviewMetadata } from '@contentful/experience-design-system-backend-pipeline';
import { ReviewDetailsEditor } from '../../../src/tui/import/steps/09-review/components/ReviewDetailsEditor.js';

it('makes saved syntax observations accessible through the actual review editor and source panel adapters', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'vue-editor-'));
  try {
    const file = join(directory, 'Example.vue');
    writeFileSync(
      file,
      `<script setup lang="ts">defineProps({ label: { type: String, default: '' } }); defineSlots<{ heading?: () => unknown }>();</script><template><slot v-if="visible" v-for="item in items" name="heading">fallback</slot><slot :name="dynamic"/></template>`,
    );
    const component = (await extractComponents({ filePaths: [file], projectRoot: directory })).components[0]!;
    const candidate = component.sourceCandidates!.find((item) => item.name === 'label')!;
    const metadata: ComponentReviewMetadata = {
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
      expect(view.lastFrame()).toContain('slot-template');
      expect(view.lastFrame()).toContain('occurrence');
      expect(view.lastFrame()).toContain('fallback');
      expect(view.lastFrame()).toContain('if:visible');
      expect(view.lastFrame()).toContain('item in items');
      expect(view.lastFrame()).toContain('dynamic-name');
      expect(view.lastFrame()).toContain('type location:');
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
      expect(frames.join('\n')).toContain('slot-template');
      expect(frames.join('\n')).toContain('fallback');
      expect(frames.join('\n')).toContain('declaration:');
    } finally {
      view.unmount();
    }
    const editor = render(
      <ReviewDetailsEditor {...props} reviewEditor={{ ...props.reviewEditor, panelOpen: 'none' }} />,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      editor.stdin.write('s');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(editor.lastFrame()).toContain('syntax label: prop');
      expect(editor.lastFrame()).toContain('occurrence');
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
      expect(JSON.parse(changed).$properties).toEqual(JSON.parse(value).$properties);
    } finally {
      editing.unmount();
    }
    expect(JSON.stringify(metadata)).toBe(before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

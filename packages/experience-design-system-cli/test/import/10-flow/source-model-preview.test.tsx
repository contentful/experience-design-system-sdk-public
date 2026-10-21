import { expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { ComponentTypeSummary, ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { CDFComponentSchema } from '@contentful/experience-design-system-types';
import { WizardPreviewStep } from '../../../src/tui/import/steps/10-flow/screens/WizardPreviewStep.js';
import { computeComponentDiffLines } from '../../../src/tui/import/steps/10-flow/support/preview-diff.js';
import type {
  ImmediateInputHandler,
  ImmediateInputKey,
} from '../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js';
const input = vi.hoisted(() => ({ handler: undefined as ImmediateInputHandler | undefined }));
vi.mock('../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js', () => ({
  useImmediateInput: (handler: ImmediateInputHandler) => {
    input.handler = handler;
  },
}));
vi.mock('../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/use-terminal-size.js', () => ({
  useTerminalSize: () => ({ columns: 160, rows: 80 }),
}));
const current: ComponentTypeSummary = {
  id: 'example',
  name: 'Example',
  contentProperties: ['data'],
  designProperties: [],
  slots: ['constructor'],
  fullProperties: { data: { type: 'record', category: 'content', required: false } },
  fullSlots: JSON.parse('{"constructor":{"required":false,"definition":{"$required":false}}}'),
};
it('keeps omitted proposed properties and slots unknown while explicit empty dictionaries remove them', () => {
  const unknown = computeComponentDiffLines(current, { key: 'Example' });
  expect(unknown.map((line) => line.text)).toEqual(['? proposed properties unknown', '? proposed slots unknown']);
  expect(unknown.every((line) => line.color === 'yellow')).toBe(true);
  const empty = computeComponentDiffLines(current, { definition: { $type: 'component', $properties: {}, $slots: {} } });
  expect(empty.map((line) => line.text)).toEqual(['- data: record, content, optional', '- slot: constructor']);
});
it.each(['direct', 'wrapped'])('treats omitted optional slots in a complete %s definition as known empty', (shape) => {
  const definition = { $type: 'component', $properties: {} };
  expect(CDFComponentSchema.safeParse(definition).success).toBe(true);
  const proposed = shape === 'direct' ? definition : { definition };
  expect(computeComponentDiffLines(current, proposed).map((line) => line.text)).toEqual([
    '- data: record, content, optional',
    '- slot: constructor',
  ]);
});
it('shows slot removal in the actual preview for a complete definition with no optional slots', async () => {
  const preview: ServerPreviewResponse = {
    components: {
      new: [],
      changed: [
        { current, proposed: { definition: { $type: 'component', $properties: {} } }, hasPendingDraftChanges: false },
      ],
      removed: [],
      unchanged: [],
    },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
  };
  const ui = render(
    <WizardPreviewStep
      preview={preview}
      spaceId="example"
      environmentId="example"
      stepNumber={1}
      totalSteps={1}
      onConfirm={vi.fn()}
      onQuit={vi.fn()}
    />,
  );
  try {
    input.handler!('d', {} as ImmediateInputKey);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ui.lastFrame()).toContain('- slot: constructor');
    expect(ui.lastFrame()).not.toContain('proposed slots unknown');
  } finally {
    ui.unmount();
  }
});
it('renders known requiredness from complete definitions and retains unknown current requiredness', () => {
  const proposed = {
    $properties: {},
    $slots: JSON.parse('{"constructor":{"$required":true},"new":{"$required":true}}'),
  };
  expect(computeComponentDiffLines(current, proposed).map((line) => line.text)).toContain(
    '+ slot constructor: required',
  );
  expect(computeComponentDiffLines(current, proposed).map((line) => line.text)).toContain('+ slot: new (required)');
  proposed.$slots.constructor.$allowedComponents = ['Example'];
  expect(computeComponentDiffLines({ ...current, fullSlots: undefined }, proposed).map((line) => line.text)).toContain(
    '? slot constructor: existing allowedComponents unknown',
  );
  expect(computeComponentDiffLines({ ...current, fullSlots: undefined }, proposed).map((line) => line.text)).toContain(
    '? slot constructor: existing requiredness unknown; proposed required',
  );
});
it('mounts the actual preview screen with unknown shapes and both required-slot reasons', async () => {
  const preview: ServerPreviewResponse = {
    components: {
      new: [],
      changed: [
        {
          current,
          proposed: { key: 'Example' },
          hasPendingDraftChanges: false,
          changeClassification: {
            classification: 'breaking',
            breakingChanges: [
              { slotId: 'constructor', reason: 'slot_became_required' },
              { slotId: 'new', reason: 'slot_added_required' },
            ],
          },
        },
      ],
      removed: [],
      unchanged: [],
    },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
  };
  const ui = render(
    <WizardPreviewStep
      preview={preview}
      spaceId="example"
      environmentId="example"
      stepNumber={1}
      totalSteps={1}
      onConfirm={vi.fn()}
      onQuit={vi.fn()}
    />,
  );
  try {
    input.handler!('d', {} as ImmediateInputKey);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ui.lastFrame()).toContain('constructor — slot now required');
    expect(ui.lastFrame()).toContain('new — new required slot');
    expect(ui.lastFrame()).toContain('proposed properties unknown');
    expect(ui.lastFrame()).toContain('proposed slots unknown');
    expect(ui.lastFrame()).not.toContain('- slot: constructor');
    expect(ui.lastFrame()).not.toContain('- data:');
    preview.components.changed[0]!.changeClassification!.breakingChanges = [];
    ui.rerender(
      <WizardPreviewStep
        preview={{ ...preview }}
        spaceId="example"
        environmentId="example"
        stepNumber={1}
        totalSteps={1}
        onConfirm={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ui.lastFrame()).toContain('BREAKING:');
  } finally {
    ui.unmount();
  }
});

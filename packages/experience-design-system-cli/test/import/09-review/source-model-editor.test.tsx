import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useState } from 'react';
import { render } from 'ink-testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  loadRawComponents,
  createStep,
  completeExtractionWithSourceEvidence,
  applyToolCalls,
  loadCDFComponents,
  loadRepresentationPlans,
} from '@contentful/experience-design-system-backend-pipeline';
import {
  extractReactComponents,
  captureSourceEvidence,
} from '../../../../experience-design-system-backend-pipeline/src/steps/extraction/index.js';
import { useReviewEditor } from '../../../src/tui/import/steps/09-review/use-review-editor.js';
import { RepresentationEditor } from '../../../src/tui/import/steps/09-review/components/RepresentationEditor.js';
import { parseToState, serializeState } from '../../../src/tui/import/steps/09-review/components/FieldEditor.js';
import type { CdfReviewEntry } from '../../../src/tui/import/steps/09-review/types.js';
import type {
  ImmediateInputHandler,
  ImmediateInputKey,
} from '../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js';
const input = vi.hoisted(() => ({ handler: undefined as ImmediateInputHandler | undefined }));
vi.mock('../../../src/tui/import/steps/07-scope-gate/sidebar/hooks/useImmediateInput.js', async () => {
  const { useRef } = await import('react');
  return {
    useImmediateInput: (handler: ImmediateInputHandler) => {
      const ref = useRef(handler);
      ref.current = handler;
      input.handler = (text, key) => ref.current(text, key);
    },
  };
});
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
async function press(text: string, key: Partial<ImmediateInputKey> = {}) {
  input.handler!(text, key as ImmediateInputKey);
  await pause();
}
let directory = '';
afterEach(() => {
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
it('chooses and edits a source model through mounted review handlers with canonical persisted identity', async () => {
  directory = mkdtempSync(join(tmpdir(), 'model-editor-'));
  const file = join(directory, 'Example.tsx');
  writeFileSync(
    file,
    `type Props={settings:{ title:'a'|'b'; nested:{flag:boolean} }};export function Example({settings}:Props){return <div>{settings.title}</div>}`,
  );
  const extracted = await extractReactComponents([file]);
  const dbPath = join(directory, 'session.db');
  vi.stubEnv('EDS_PIPELINE_DB_PATH', dbPath);
  let db = openPipelineDb();
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, extracted.components);
  const owner = loadRawComponents(db, sessionId)[0]!;
  const capture = await captureSourceEvidence({
    projectRoot: directory,
    filePaths: [file],
    components: [{ componentId: owner.component_id, name: owner.name, sourcePath: file }],
  });
  completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId: createStep(db, sessionId, 'analyze extract', { project: directory }),
    components: extracted.components,
    cycles: [],
    scannedFiles: [file],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  applyToolCalls(
    db,
    sessionId,
    owner.component_id,
    owner.name,
    [
      { tool: 'classify_component' },
      { tool: 'classify_prop', prop: 'settings', cdf_category: 'content', reason: 'Review source model' },
    ],
    [],
  );
  const initial = loadCDFComponents(db, sessionId)[0]!;
  db.close();
  const callback = vi.fn();
  let current: CdfReviewEntry = { ...initial, status: 'needs-review' };
  function Probe() {
    const [entries, setEntries] = useState<CdfReviewEntry[]>([current]);
    current = entries[0]!;
    const editor = useReviewEditor({
      components: entries,
      selectedIdx: 0,
      extractSessionId: sessionId,
      availableTokens: [],
      setComponents: setEntries,
      pushHistorySnapshot: vi.fn(),
      onEditSaved: callback,
      onTokenSaved: vi.fn(),
    });
    return (
      <RepresentationEditor
        entry={current.entry}
        width={100}
        height={24}
        choices={editor.representationChoices}
        choose={editor.chooseRepresentation}
        save={editor.handleEditSave}
        close={vi.fn()}
      />
    );
  }
  const ui = render(<Probe />);
  try {
    expect(ui.lastFrame()).toContain('component-model');
    await press('', { return: true });
    expect(callback).toHaveBeenCalled();
    const plan = current.entry.$representationPlans!.settings!;
    expect(ui.lastFrame()).toContain('Desired definition saved');
    await press('', { return: true });
    await press('j', { ctrl: true });
    await press('a', { ctrl: true });
    const model = plan.models[0]!;
    const changed = structuredClone(model.entry);
    changed.$properties.title!.$default = 'b';
    await press(JSON.stringify(changed));
    await press('s', { ctrl: true });
    expect(ui.lastFrame()).not.toContain('Save failed');
    expect(current.entry.$representationPlans!.settings!.id).not.toBe(plan.id);
    const canonical = current.entry.$representationPlans!.settings!;
    expect(canonical.models[0]!.entry.$properties.title!.$default).toBe('b');
    const state = parseToState(JSON.stringify(current.entry)).state;
    expect(JSON.parse(serializeState(state, JSON.stringify(current.entry))).$representationPlans).toEqual(
      current.entry.$representationPlans,
    );
    db = openPipelineDb();
    expect(loadRepresentationPlans(db, sessionId, owner.component_id)[0]!.plan).toEqual(canonical);
    db.close();
  } finally {
    ui.unmount();
  }
});

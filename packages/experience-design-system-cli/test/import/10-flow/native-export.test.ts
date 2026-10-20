import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  openPipelineDb,
  getOrCreateSession,
  storeCDFComponents,
  loadCDFComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import { validateCDF } from '@contentful/experience-design-system-types';
import { parseToState, serializeState } from '../../../src/tui/import/steps/09-review/components/FieldEditor.js';
import { runPrintFiles, realSaveDeps } from '../../../src/tui/import/steps/10-flow/flow/save.js';
it('uses actual editor, close/reopen readback and runPrintFiles export without truncating native definitions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'native-export-'));
  const dbPath = join(directory, 'session.db');
  try {
    const property = JSON.parse(
      '{"$type":"array","$category":"content","$required":false,"$items":{"$type":"record","$required":true,"$fields":{"__proto__":{"$type":"boolean","$required":false},"constructor":{"$type":"string","$required":false,"$default":""},"a.b/λ":{"$type":"number","$required":true,"$values":[0,1]}}},"$default":[{"__proto__":false,"a.b/λ":0}]}',
    );
    let db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', 'example', { command: 'analyze extract' });
    storeCDFComponents(db, sessionId, [
      { key: 'Example', entry: { $type: 'component', $properties: { rows: property } } },
    ]);
    db.close();
    db = openPipelineDb(dbPath);
    const original = JSON.stringify(loadCDFComponents(db, sessionId)[0]!.entry);
    const { state, error } = parseToState(original);
    expect(error).toBeNull();
    state.componentDescription = 'Updated';
    state.props[0]!.description = 'Rows';
    storeCDFComponents(db, sessionId, [{ key: 'Example', entry: JSON.parse(serializeState(state, original)) }]);
    db.close();
    const result = await runPrintFiles(
      { extractSessionId: sessionId, outDir: directory },
      { ...realSaveDeps(), openDb: () => openPipelineDb(dbPath), sleep: async () => {}, warn: vi.fn() },
      vi.fn(),
    );
    expect(result.ok).toBe(true);
    const exported = JSON.parse(readFileSync(join(directory, 'components.json'), 'utf8'));
    expect(validateCDF(exported).valid).toBe(true);
    expect(exported.Example.$properties.rows).toEqual({ ...property, $description: 'Rows' });
    expect(Object.hasOwn(exported.Example.$properties.rows.$items.$fields, '__proto__')).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

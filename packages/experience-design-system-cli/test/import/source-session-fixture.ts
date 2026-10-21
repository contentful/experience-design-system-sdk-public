import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  extractReactComponents,
  captureSourceEvidence,
} from '../../../experience-design-system-extraction/src/index.js';
import {
  storeRawComponents,
  loadRawComponents,
  createStep,
  completeExtractionWithSourceEvidence,
  applyToolCalls,
  storeCDFComponents,
} from '@contentful/experience-design-system-backend-pipeline';

export async function seedCompleteEmptyComponents(
  db: DatabaseSync,
  sessionId: string,
  directory: string,
  names: string[],
): Promise<void> {
  const path = join(directory, `${sessionId}.tsx`);
  await writeFile(path, names.map((name) => `export function ${name}(){return <div/>}`).join('\n'));
  const extracted = await extractReactComponents([path]);
  const components = extracted.components.filter((component) => names.includes(component.name));
  storeRawComponents(db, sessionId, components);
  const raw = loadRawComponents(db, sessionId);
  const capture = await captureSourceEvidence({
    projectRoot: directory,
    filePaths: [path],
    components: raw.map((component) => ({
      componentId: component.component_id,
      name: component.name,
      sourcePath: path,
    })),
  });
  completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId: createStep(db, sessionId, 'analyze extract', { project: directory }),
    components,
    cycles: [],
    scannedFiles: [path],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  for (const component of loadRawComponents(db, sessionId))
    applyToolCalls(db, sessionId, component.component_id, component.name, [{ tool: 'classify_component' }], []);
}

export async function seedCompleteDefinitions(
  db: DatabaseSync,
  sessionId: string,
  directory: string,
  entries: Parameters<typeof storeCDFComponents>[2],
): Promise<void> {
  type Field = {
    $type: string;
    $required?: boolean;
    $values?: unknown[];
    $fields?: Record<string, Field>;
    $items?: Field;
  };
  const sourceType = (field: Field): string => {
    if (field.$values?.length) return field.$values.map((value) => JSON.stringify(value)).join(' | ');
    if (field.$type === 'number' || field.$type === 'boolean') return field.$type;
    if (field.$type === 'array') return `Array<${sourceType(field.$items!)}>`;
    if (field.$type === 'record')
      return `{${Object.entries(field.$fields!)
        .map(([key, value]) => `${JSON.stringify(key)}${value.$required ? '' : '?'}: ${sourceType(value)}`)
        .join(';')}}`;
    return 'string';
  };
  const path = join(directory, `${sessionId}-definitions.tsx`);
  await writeFile(
    path,
    entries
      .map(
        ({ key, entry }) =>
          `export function ${key}(props: {${Object.entries(entry.$properties)
            .map(([name, field]) => `${JSON.stringify(name)}${field.$required ? '' : '?'}: ${sourceType(field)}`)
            .join(';')}}){return <div/>}`,
      )
      .join('\n'),
  );
  const components = (await extractReactComponents([path])).components.filter((component) =>
    entries.some((entry) => entry.key === component.name),
  );
  storeRawComponents(db, sessionId, components);
  const raw = loadRawComponents(db, sessionId);
  const capture = await captureSourceEvidence({
    projectRoot: directory,
    filePaths: [path],
    components: raw.map((component) => ({
      componentId: component.component_id,
      name: component.name,
      sourcePath: path,
    })),
  });
  completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId: createStep(db, sessionId, 'analyze extract', { project: directory }),
    components,
    cycles: [],
    scannedFiles: [path],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  storeCDFComponents(db, sessionId, entries);
}

import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { extractReactComponents, captureSourceEvidence } from '../src/steps/extraction/index.js';
import type { RawComponentDefinition } from '../src/steps/extraction/src/types/component.js';
import {
  storeRawComponents,
  loadRawComponents,
  createStep,
  completeExtractionWithSourceEvidence,
} from '../src/persistence/src/session/repositories/db.js';

export async function hydrateSourceFixture(
  component: RawComponentDefinition,
  projectRoot: string,
): Promise<RawComponentDefinition> {
  const path = resolve(projectRoot, component.sourcePath ?? component.source);
  const produced = (await extractReactComponents([path], undefined, { projectRoot })).components.find(
    (entry) => entry.name === component.name,
  );
  if (!produced) throw new Error('Fixture component declaration unavailable');
  return {
    ...component,
    sourcePath: path,
    factSchemaVersion: produced.factSchemaVersion,
    sourceCandidates: produced.sourceCandidates,
    sourceCandidateSources: produced.sourceCandidateSources,
    componentFacts: component.componentFacts ?? produced.componentFacts,
  };
}

export async function completeSourceFixture(
  db: DatabaseSync,
  sessionId: string,
  directory: string,
  components: RawComponentDefinition[],
): Promise<void> {
  const bound = await Promise.all(components.map((component) => hydrateSourceFixture(component, directory)));
  storeRawComponents(db, sessionId, bound);
  const rows = loadRawComponents(db, sessionId);
  const paths = [...new Set(bound.map((component) => component.sourcePath!))];
  const capture = await captureSourceEvidence({
    projectRoot: directory,
    filePaths: paths,
    components: rows.map((component) => ({
      componentId: component.component_id,
      name: component.name,
      sourcePath: component.sourcePath!,
    })),
  });
  completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId: createStep(db, sessionId, 'analyze extract', { project: directory }),
    components: bound,
    cycles: [],
    scannedFiles: paths,
    capture,
    observations: { accepted: [], rejected: [] },
  });
}

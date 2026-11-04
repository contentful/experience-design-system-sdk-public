import type { ExplorationSourceInput } from '@contentful/experience-design-system-types';
import type { SessionSourceEnvelope } from '../../../persistence/src/session/repositories/db.js';
import { projectExplorationSource } from '../../../source-evidence/shared-source.js';

export function buildExplorationSourceInput(
  envelope: SessionSourceEnvelope,
  compilerDiagnostics?: unknown,
): ExplorationSourceInput {
  return projectExplorationSource(envelope, compilerDiagnostics);
}

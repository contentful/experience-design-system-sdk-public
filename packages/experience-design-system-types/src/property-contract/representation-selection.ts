import { prepareAnalysisRepresentationCandidates } from './analysis-representation-candidates.js';
import { jsonValueIssue, type PropertyIssue } from './json-value.js';
import type { PropertyModel } from './property-model.js';

export interface RepresentationSelection {
  strategy: 'native' | 'component-model';
  candidateId: string;
  sourceRevision: string;
  sourceNodeId: string;
}

export function validateRepresentationSelection(input: unknown, model?: PropertyModel): PropertyIssue[] {
  const invalid = jsonValueIssue(input);
  if (invalid) return [invalid];
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return [{ path: '/representationSelection', message: 'Source-bound representation selection required' }];
  const selection = input as Record<string, unknown>;
  if (
    Object.keys(selection).some(
      (key) => !['strategy', 'candidateId', 'sourceRevision', 'sourceNodeId'].includes(key),
    ) ||
    !['native', 'component-model'].includes(String(selection.strategy)) ||
    ['candidateId', 'sourceRevision', 'sourceNodeId'].some(
      (key) => typeof selection[key] !== 'string' || !String(selection[key]).trim(),
    )
  )
    return [{ path: '/representationSelection', message: 'Invalid representation selection identity' }];
  if (
    model &&
    (selection.sourceRevision !== model.identity.sourceRevision ||
      selection.sourceNodeId !== model.identity.nodeId ||
      !prepareAnalysisRepresentationCandidates(model).candidates.some(
        (candidate) => candidate.id === selection.candidateId && candidate.strategy === selection.strategy,
      ))
  )
    return [{ path: '/representationSelection', message: 'Selection is not a current source-derived candidate' }];
  return [];
}

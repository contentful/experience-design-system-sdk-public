import type { ImportProfileActivity } from './import-profile.js';

const labels = {
  'inventory.validate-captured-source': 'Validate captured source for selected inputs',
  'inventory.load-captured-owners': 'Load selected component facts and type evidence',
  'inventory.build-input-checklists': 'Build selected source-input checklists',
  'inventory.bind-owner-descriptors': 'Bind selected input inventory identities',
  'inventory.hash-owner-evidence': 'Fingerprint selected owner evidence',
  'source.validation.warm': 'Verify and index saved source once for reuse',
  'extraction.extract': 'Parse source and resolve component types',
  'extraction.session-ack': 'Register extraction session',
  'extraction.validate': 'Validate extracted component definitions',
  'extraction.store': 'Save extracted component records',
  'source.capture': 'Capture source files and compiler evidence',
  'extraction.composition': 'Resolve component relationships',
  'extraction.bind.validate-facts': 'Validate facts before capture binding',
  'extraction.bind.references': 'Bind collected source references',
  'extraction.bind.graphs': 'Bind component facts and candidate type graphs',
  'extraction.bind.candidate-digests': 'Fingerprint bound candidate evidence',
  'extraction.bind.compiler-reads': 'Bind compiler read receipts',
  'extraction.finalize.encode-observations': 'Encode collected observations and references',
  'extraction.finalize.encode-candidate-digests': 'Encode candidate fingerprints',
  'source.finalize.root': 'Assemble final captured root',
  'source.finalize.seal-index': 'Seal captured record index',
  'source.finalize.flush-and-close': 'Flush captured records and working stores',
  'source.catalog.files': 'Validate and catalog captured files and owners',
  'source.catalog.resolution': 'Catalog captured import resolution',
  'source.catalog.compiler-contexts': 'Catalog compiler contexts and configuration',
  'source.catalog.references': 'Validate and catalog source references',
  'extraction.publish.authenticate-source': 'Authenticate sealed source before publication',
  'extraction.publish.completion-writes': 'Persist bound components and completion metadata',
  'extraction.publish.commit': 'Commit extraction publication',
  'extraction.prepare-completion': 'Bind extraction evidence and definitions',
  'extraction.capture-finalize': 'Finalize captured evidence',
  'extraction.publish': 'Publish source evidence and relationships',
  'source.digest.envelope': 'Verify saved evidence envelope',
  'source.digest.capture': 'Verify inner source capture',
  'source.catalog.build': 'Build source lookup catalog',
  'evidence.source-files': 'Project captured source files',
  'evidence.owners': 'Load, validate and bind component evidence',
  'evidence.encoding': 'Encode prepared evidence records',
  'evidence.digest': 'Fingerprint prepared evidence',
  'evidence.prompt-catalog': 'Build agent lookup catalog',
} as const;
export interface PreparationStepProgress {
  id: keyof typeof labels;
  label: string;
  status: 'running' | 'complete' | 'failed';
  elapsedMs: number;
}
export function boundPreparationProgress(value: unknown): PreparationStepProgress[] | undefined {
  if (!Array.isArray(value) || value.length > Object.keys(labels).length) return undefined;
  const seen = new Set<string>();
  const steps: PreparationStepProgress[] = [];
  for (const step of value) {
    if (
      !step ||
      typeof step !== 'object' ||
      !Object.hasOwn(labels, step.id) ||
      seen.has(step.id) ||
      !['running', 'complete', 'failed'].includes(step.status) ||
      !Number.isFinite(step.elapsedMs) ||
      step.elapsedMs < 0
    )
      return undefined;
    seen.add(step.id);
    const id = step.id as keyof typeof labels;
    steps.push({ id, label: labels[id], status: step.status, elapsedMs: step.elapsedMs });
  }
  return steps;
}
export function collectPreparationProgress(
  publish: (steps: readonly PreparationStepProgress[]) => void,
): (event: ImportProfileActivity) => void {
  const steps = new Map<string, PreparationStepProgress>();
  return (event) => {
    if (!Object.hasOwn(labels, event.name)) return;
    const id = event.name as keyof typeof labels;
    steps.set(id, {
      id,
      label: labels[id],
      elapsedMs: event.elapsedMs,
      status: event.status === 'running' ? 'running' : event.status === 'success' ? 'complete' : 'failed',
    });
    publish([...steps.values()]);
  };
}

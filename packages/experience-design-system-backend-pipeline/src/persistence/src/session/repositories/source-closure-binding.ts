import { bindSourceClosureToCapture, type SourceClosureEvidence } from '../../../../steps/extraction/index.js';
import type { CompletedSourceEvidence } from './db.js';

function unavailableClosure(evidence: SourceClosureEvidence, reason: string): SourceClosureEvidence {
  return {
    ...evidence,
    status: 'unavailable',
    binding: 'unavailable',
    reason,
    nodes: evidence.nodes.map((node) => ({ ...node, location: { ...node.location, binding: 'unavailable' } })),
  };
}
/** Reopen verifies the completed envelope instead of trusting a saved verified label. */
export function validateSavedSourceClosure(
  evidence: SourceClosureEvidence,
  source: CompletedSourceEvidence,
): SourceClosureEvidence {
  if (source.readiness !== 'ready') return unavailableClosure(evidence, source.reason);
  const envelope = source.envelope;
  const binding = evidence.captureBinding;
  if (
    !binding ||
    binding.captureId !== envelope.capture.captureId ||
    binding.captureDigest !== envelope.capture.digest ||
    binding.envelopeId !== envelope.envelopeId ||
    binding.envelopeDigest !== envelope.digest ||
    binding.sessionId !== envelope.sessionId ||
    binding.extractionStepId !== envelope.extractionStepId
  )
    return unavailableClosure(evidence, 'capture-envelope-mismatch');
  const bound = bindSourceClosureToCapture(evidence, envelope.capture.files, binding);
  if (bound.binding !== 'verified' && bound.status !== 'failed')
    return {
      ...bound,
      status: bound.binding === 'changed' ? 'partial' : 'unavailable',
      reason: `source-binding-${bound.binding}`,
    };
  return bound;
}

import {
  bindSourceClosureToCapture,
  type SourceClosureEvidence,
} from '@contentful/experience-design-system-extraction';
import type { CompletedSourceEvidence } from './db.js';
/** Reopen verifies the completed envelope instead of trusting a saved verified label. */
export function validateSavedSourceClosure(
  evidence: SourceClosureEvidence,
  source: CompletedSourceEvidence,
): SourceClosureEvidence {
  if (source.readiness !== 'ready')
    return { ...evidence, status: 'unavailable', binding: 'unavailable', reason: source.reason };
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
    return { ...evidence, status: 'unavailable', binding: 'unavailable', reason: 'capture-envelope-mismatch' };
  const bound = bindSourceClosureToCapture(evidence, envelope.capture.files, binding);
  if (bound.binding !== 'verified' && bound.status !== 'failed')
    return {
      ...bound,
      status: bound.binding === 'changed' ? 'partial' : 'unavailable',
      reason: `source-binding-${bound.binding}`,
    };
  return bound;
}

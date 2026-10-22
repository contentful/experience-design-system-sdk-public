import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FIELD_VALUE_PREMISES } from './field-semantics.js';

export const FIELD_REPLAY_PREMISES = [
  ...FIELD_VALUE_PREMISES,
  'declared-own-input-tree',
  'stable-resolved-callable-bindings',
] as const;
export const FIELD_REPLAY_VERSION = 5;
const claim = z
  .object({
    status: z.enum(['conditional', 'unknown']),
    premises: z.array(z.string()),
    reasons: z.array(z.string()),
  })
  .strict();
const subject = {
  inputName: z.string(),
  path: z.array(z.object({ kind: z.literal('field'), key: z.string() }).strict()),
};
const comparison = z.object({ left: z.string().nullable(), right: z.string().nullable() }).strict();

/** A bounded paired derivation, whose runtime and delivery premises remain unestablished. */
export const FieldReplaySchema = z
  .object({
    schemaVersion: z.literal(FIELD_REPLAY_VERSION),
    semantics: z.literal('paired-own-data-field-flow'),
    status: z.enum(['unverified', 'matched', 'mismatch', 'unavailable']),
    componentDeclarationId: z.string().min(1),
    domain: z.array(z.object(subject).strict()),
    observables: z.literal('returned-atom-and-supported-synchronous-effects'),
    limits: z
      .object({
        maxNodes: z.number().int().nonnegative(),
        maxDepth: z.number().int().nonnegative(),
        maxOperations: z.number().int().nonnegative(),
      })
      .strict(),
    used: z.object({ nodes: z.number().int().nonnegative(), maxDepth: z.number().int().nonnegative() }).strict(),
    frames: z.array(
      z
        .object({
          frame: z.number().int().positive(),
          parentFrame: z.number().int().nonnegative(),
          callStartOffset: z.number().int().nonnegative(),
          callEndOffset: z.number().int().nonnegative(),
          targetStartOffset: z.number().int().nonnegative(),
          targetEndOffset: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    operations: z.array(
      z
        .object({
          operation: z.enum(['binding', 'spread', 'write', 'read', 'return', 'branch', 'call', 'iterate']),
          frame: z.number().int().nonnegative(),
          iterations: z.array(z.number().int().nonnegative()),
          startOffset: z.number().int().nonnegative(),
          endOffset: z.number().int().nonnegative(),
          conditions: z.array(
            z
              .object({
                startOffset: z.number().int().nonnegative(),
                endOffset: z.number().int().nonnegative(),
                branch: z.enum(['truthy', 'falsy']),
                term: z.string().min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    results: z.array(
      z
        .object({
          ...subject,
          valueComparison: comparison,
          omissionComparison: comparison,
          valueIndependence: claim,
          omissionSafety: claim,
          reasons: z.array(z.string()),
        })
        .strict(),
    ),
    identity: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type SourceFieldReplay = z.infer<typeof FieldReplaySchema>;

export function fieldReplayIdentity(value: Omit<SourceFieldReplay, 'identity'> | SourceFieldReplay): string {
  const { status: _status, ...payload } = value;
  if ('identity' in payload) delete (payload as Partial<SourceFieldReplay>).identity;
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function fieldReplayIsConsistent(value: SourceFieldReplay): boolean {
  if (
    fieldReplayIdentity(value) !== value.identity ||
    value.used.nodes > value.limits.maxNodes ||
    value.used.maxDepth > value.limits.maxDepth ||
    value.operations.length > value.limits.maxOperations ||
    value.frames.length > value.limits.maxOperations ||
    value.frames.some(
      (frame, index) =>
        frame.frame !== index + 1 ||
        frame.parentFrame >= frame.frame ||
        frame.callEndOffset <= frame.callStartOffset ||
        frame.targetEndOffset <= frame.targetStartOffset,
    ) ||
    value.domain.length !== value.results.length ||
    new Set(value.domain.map((item) => JSON.stringify(item))).size !== value.domain.length ||
    value.operations.some(
      (operation) =>
        operation.endOffset <= operation.startOffset ||
        operation.frame > value.frames.length ||
        operation.iterations.length > value.limits.maxDepth ||
        operation.conditions.length > value.limits.maxDepth ||
        operation.conditions.some((condition) => condition.endOffset <= condition.startOffset),
    )
  )
    return false;
  return value.results.every((result, index) => {
    if (JSON.stringify(value.domain[index]) !== JSON.stringify({ inputName: result.inputName, path: result.path }))
      return false;
    return (
      [
        ['valueIndependence', 'valueComparison'],
        ['omissionSafety', 'omissionComparison'],
      ] as const
    ).every(([key, pair]) => {
      const current = result[key];
      return (
        current.status !== 'conditional' ||
        (current.reasons.length === 0 &&
          result[pair].left !== null &&
          result[pair].left === result[pair].right &&
          FIELD_REPLAY_PREMISES.every((premise) => current.premises.includes(premise)) &&
          (key !== 'omissionSafety' || current.premises.includes('entry-delivery-admits-omission')))
      );
    });
  });
}

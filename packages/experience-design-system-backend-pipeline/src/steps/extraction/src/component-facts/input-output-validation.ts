import type { SourceInputOutputEvidence } from '../types/source-input-output.js';
import { isPlainSourceContract, isSourceFactLocation } from '../../source-closure/validation.js';
type RecordValue = Record<string, unknown>;
function record(value: unknown, required: string[]): value is RecordValue {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key))
  );
}
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const array = (value: unknown, validate: (value: unknown) => boolean): boolean =>
  Array.isArray(value) && value.every(validate);
function destination(value: unknown): boolean {
  return (
    record(value, ['kind', 'name', 'inputName', 'declarationId', 'location']) &&
    ['intrinsic', 'callable', 'unknown'].includes(value.kind as string) &&
    text(value.name) &&
    text(value.inputName) &&
    (value.declarationId === null || text(value.declarationId)) &&
    isSourceFactLocation(value.location)
  );
}
export function readInputOutput(
  value: unknown,
):
  | { status: 'available'; evidence: SourceInputOutputEvidence }
  | { status: 'unsupported' | 'corrupt' | 'unknown-legacy' } {
  if (value === undefined) return { status: 'unknown-legacy' };
  if (!isPlainSourceContract(value)) return { status: 'corrupt' };
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1)
    return { status: 'unsupported' };
  if (
    !record(value, [
      'schemaVersion',
      'semantics',
      'componentDeclarationId',
      'coverage',
      'inputs',
      'witnesses',
      'summaries',
      'omissions',
      'used',
    ]) ||
    value.schemaVersion !== 1 ||
    value.semantics !== 'bounded-source-dependencies' ||
    !text(value.componentDeclarationId) ||
    !['complete-within-declared-bound', 'partial', 'unavailable'].includes(value.coverage as string)
  )
    return { status: 'corrupt' };
  if (
    !array(
      value.inputs,
      (input) =>
        record(input, ['name', 'rootSymbolId', 'declaration', 'parameterIndex', 'inputPath']) &&
        text(input.name) &&
        text(input.rootSymbolId) &&
        isSourceFactLocation(input.declaration) &&
        Number.isSafeInteger(input.parameterIndex) &&
        (input.parameterIndex as number) >= 0 &&
        strings(input.inputPath) &&
        input.inputPath[0] === input.name,
    )
  )
    return { status: 'corrupt' };
  if (
    !array(
      value.witnesses,
      (witness) =>
        record(witness, [
          'id',
          'inputName',
          'inputPath',
          'rootSymbolId',
          'kind',
          'context',
          'location',
          'destination',
          'enclosing',
          'via',
          'conditions',
          'strength',
          'reasons',
        ]) &&
        text(witness.id) &&
        text(witness.inputName) &&
        strings(witness.inputPath) &&
        text(witness.rootSymbolId) &&
        ['returned-value', 'intrinsic-attribute', 'receiver-input', 'guard'].includes(witness.kind as string) &&
        ['returned', 'discarded', 'deferred', 'referenced'].includes(witness.context as string) &&
        isSourceFactLocation(witness.location) &&
        (witness.destination === null || destination(witness.destination)) &&
        array(witness.enclosing, destination) &&
        array(witness.via, isSourceFactLocation) &&
        array(
          witness.conditions,
          (condition) =>
            record(condition, ['expression', 'branch', 'location']) &&
            text(condition.expression) &&
            ['then', 'else', 'truthy', 'falsy', 'body', 'case', 'nullish'].includes(condition.branch as string) &&
            isSourceFactLocation(condition.location),
        ) &&
        ['exact', 'inferred', 'unknown'].includes(witness.strength as string) &&
        strings(witness.reasons),
    )
  )
    return { status: 'corrupt' };
  if (
    !array(
      value.summaries,
      (summary) =>
        record(summary, ['inputName', 'state', 'scope', 'witnessIds', 'reasons']) &&
        text(summary.inputName) &&
        ['positive', 'absent', 'open'].includes(summary.state as string) &&
        summary.scope === 'component-return' &&
        strings(summary.witnessIds) &&
        strings(summary.reasons),
    )
  )
    return { status: 'corrupt' };
  if (
    !array(
      value.omissions,
      (item) =>
        record(item, ['reason', 'location']) &&
        text(item.reason) &&
        (item.location === null || isSourceFactLocation(item.location)),
    ) ||
    !record(value.used, ['nodes', 'maxDepth', 'witnesses']) ||
    !Object.values(value.used).every((item) => Number.isSafeInteger(item) && (item as number) >= 0)
  )
    return { status: 'corrupt' };
  const evidence = value as unknown as SourceInputOutputEvidence;
  const inputs = new Map(evidence.inputs.map((input) => [input.name, input]));
  const witnesses = new Map(evidence.witnesses.map((witness) => [witness.id, witness]));
  if (
    inputs.size !== evidence.inputs.length ||
    witnesses.size !== evidence.witnesses.length ||
    evidence.used.witnesses !== witnesses.size ||
    new Set(evidence.summaries.map((summary) => summary.inputName)).size !== inputs.size ||
    evidence.summaries.length !== inputs.size
  )
    return { status: 'corrupt' };
  if (
    evidence.witnesses.some(
      (witness) =>
        inputs.get(witness.inputName)?.rootSymbolId !== witness.rootSymbolId ||
        witness.inputPath[0] !== witness.inputName ||
        (witness.reasons.length > 0 && witness.strength !== 'unknown'),
    )
  )
    return { status: 'corrupt' };
  if (
    evidence.summaries.some(
      (summary) =>
        !inputs.has(summary.inputName) ||
        summary.witnessIds.some((id) => {
          const witness = witnesses.get(id);
          return (
            !witness ||
            witness.inputName !== summary.inputName ||
            witness.context !== 'returned' ||
            witness.kind === 'guard' ||
            witness.kind === 'receiver-input'
          );
        }) ||
        (summary.state === 'positive' && !summary.witnessIds.some((id) => witnesses.get(id)!.strength !== 'unknown')) ||
        new Set(summary.witnessIds).size !== summary.witnessIds.length ||
        evidence.witnesses.some(
          (witness) =>
            witness.inputName === summary.inputName &&
            witness.context === 'returned' &&
            witness.kind !== 'guard' &&
            witness.kind !== 'receiver-input' &&
            !summary.witnessIds.includes(witness.id),
        ) ||
        (summary.state === 'absent' &&
          (summary.witnessIds.length > 0 ||
            summary.reasons.length > 0 ||
            evidence.coverage !== 'complete-within-declared-bound')),
    )
  )
    return { status: 'corrupt' };
  return { status: 'available', evidence };
}

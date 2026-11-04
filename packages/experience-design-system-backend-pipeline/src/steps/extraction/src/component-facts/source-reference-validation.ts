import type { SourceReferenceIndex } from '../types/source-references.js';
import { isPlainSourceContract, isSourceFactLocation } from '../../source-closure/validation.js';
import {
  exactRecord as record,
  sourceArray as array,
  sourceCount as count,
  sourceScalar as scalar,
  sourceStrings as strings,
  sourceText as text,
} from '../../source-evidence/plain-validation.js';
const nullableLocation = (value: unknown) => value === null || isSourceFactLocation(value);
const components = (value: unknown) =>
  array(
    value,
    (item) =>
      record(item, ['declarationId', 'location']) && text(item.declarationId) && isSourceFactLocation(item.location),
  );
const conditions = (value: unknown) =>
  array(
    value,
    (item) =>
      record(item, ['expression', 'branch', 'location']) &&
      text(item.expression) &&
      ['then', 'else', 'truthy', 'falsy', 'body', 'case', 'nullish', 'non-nullish'].includes(item.branch as string) &&
      isSourceFactLocation(item.location),
  );
function caller(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = [
    'name',
    'parameterIndex',
    'state',
    'origin',
    'representation',
    'expression',
    'location',
    'valueLocation',
    'components',
    'reasons',
    'parts',
  ];
  if (Object.hasOwn(value, 'value')) keys.push('value');
  return (
    record(value, keys) &&
    text(value.name) &&
    (value.parameterIndex === null || count(value.parameterIndex)) &&
    ['provided', 'omitted', 'unknown'].includes(value.state as string) &&
    ['fixed', 'forwarded', 'unknown'].includes(value.origin as string) &&
    ['literal', 'jsx', 'callback', 'expression'].includes(value.representation as string) &&
    (value.expression === null || text(value.expression)) &&
    (!Object.hasOwn(value, 'value') || scalar(value.value)) &&
    isSourceFactLocation(value.location) &&
    nullableLocation(value.valueLocation) &&
    components(value.components) &&
    strings(value.reasons) &&
    array(value.parts, caller)
  );
}
function reference(value: unknown): boolean {
  return (
    record(value, [
      'id',
      'kind',
      'location',
      'expression',
      'owner',
      'ancestors',
      'conditions',
      'targets',
      'inputs',
      'history',
      'arguments',
      'reasons',
    ]) &&
    text(value.id) &&
    ['import', 'reexport', 'type', 'value', 'assignment', 'call', 'jsx'].includes(value.kind as string) &&
    isSourceFactLocation(value.location) &&
    text(value.expression) &&
    nullableLocation(value.owner) &&
    array(value.ancestors, isSourceFactLocation) &&
    conditions(value.conditions) &&
    array(
      value.targets,
      (item) =>
        record(item, ['declarationId', 'location', 'conditions']) &&
        text(item.declarationId) &&
        isSourceFactLocation(item.location) &&
        conditions(item.conditions),
    ) &&
    array(value.inputs, caller) &&
    array(value.history, caller) &&
    array(value.arguments, caller) &&
    strings(value.reasons)
  );
}
function summary(value: unknown): boolean {
  return (
    record(value, ['inputName', 'inputDeclaration', 'constraint', 'counts', 'samples', 'components', 'reasons']) &&
    text(value.inputName) &&
    nullableLocation(value.inputDeclaration) &&
    record(value.constraint, ['kind', 'alternatives', 'typeText']) &&
    ['finite', 'open', 'unknown'].includes(value.constraint.kind as string) &&
    array(value.constraint.alternatives, scalar) &&
    text(value.constraint.typeText) &&
    record(value.counts, ['provided', 'omitted', 'unknown', 'fixed', 'forwarded']) &&
    Object.values(value.counts).every(count) &&
    array(
      value.samples,
      (item) =>
        record(item, ['value', 'location', 'referenceId', 'violation']) &&
        scalar(item.value) &&
        isSourceFactLocation(item.location) &&
        text(item.referenceId) &&
        typeof item.violation === 'boolean',
    ) &&
    array(
      value.components,
      (item) =>
        record(item, ['declarationId', 'location', 'count']) &&
        text(item.declarationId) &&
        isSourceFactLocation(item.location) &&
        count(item.count),
    ) &&
    strings(value.reasons)
  );
}
export function readSourceReferences(
  value: unknown,
): { status: 'available'; evidence: SourceReferenceIndex } | { status: 'corrupt' | 'unsupported' | 'unknown-legacy' } {
  if (value === undefined) return { status: 'unknown-legacy' };
  if (!isPlainSourceContract(value)) return { status: 'corrupt' };
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1)
    return { status: 'unsupported' };
  if (
    !record(value, [
      'schemaVersion',
      'semantics',
      'componentDeclarationId',
      'declaration',
      'files',
      'references',
      'summaries',
      'coverage',
      'limits',
      'used',
      'omissions',
    ]) ||
    value.schemaVersion !== 1 ||
    value.semantics !== 'lexical-reference-observations' ||
    !text(value.componentDeclarationId) ||
    !isSourceFactLocation(value.declaration) ||
    !array(
      value.files,
      (item) =>
        record(item, ['location', 'selected', 'roles']) &&
        isSourceFactLocation(item.location) &&
        typeof item.selected === 'boolean' &&
        strings(item.roles),
    ) ||
    !array(value.references, reference) ||
    !array(value.summaries, summary) ||
    !['partial', 'unavailable', 'complete-within-declared-bound'].includes(value.coverage as string) ||
    !record(value.limits, ['maxNodes', 'maxReferences', 'maxFiles', 'maxDepth']) ||
    !Object.values(value.limits).every(count) ||
    !record(value.used, ['nodes', 'references', 'files', 'depth']) ||
    !Object.values(value.used).every(count) ||
    !array(
      value.omissions,
      (item) =>
        record(item, ['reason', 'location', 'count']) &&
        text(item.reason) &&
        nullableLocation(item.location) &&
        count(item.count),
    )
  )
    return { status: 'corrupt' };
  const index = value as unknown as SourceReferenceIndex;
  const identity = (location: SourceReferenceIndex['declaration']) =>
    `${location.canonicalPath}:${location.textHash}:${location.startOffset}:${location.endOffset}`;
  if (
    index.componentDeclarationId !== identity(index.declaration) ||
    index.used.references !== index.references.length ||
    index.used.files !== index.files.length ||
    new Set(index.references.map((item) => item.id)).size !== index.references.length ||
    index.references.some(
      (item) =>
        item.id !== `${identity(item.location)}:${item.kind}` ||
        item.targets.some((target) => identity(target.location) !== target.declarationId),
    )
  )
    return { status: 'corrupt' };
  if (
    index.used.nodes > index.limits.maxNodes ||
    index.used.references > index.limits.maxReferences ||
    index.used.files > index.limits.maxFiles ||
    index.used.depth > index.limits.maxDepth + 1 ||
    new Set(index.files.map((file) => file.location.canonicalPath)).size !== index.files.length ||
    new Set(index.summaries.map((item) => item.inputName)).size !== index.summaries.length
  )
    return { status: 'corrupt' };
  for (const item of index.references) {
    if (
      !(
        item.targets.some((target) => target.declarationId === index.componentDeclarationId) ||
        (!item.targets.length && item.reasons.length)
      ) ||
      new Set(item.inputs.map((input) => input.name)).size !== item.inputs.length
    )
      return { status: 'corrupt' };
    if (
      item.owner &&
      (!item.ancestors.length || identity(item.owner) !== identity(item.ancestors[item.ancestors.length - 1]!))
    )
      return { status: 'corrupt' };
  }
  for (const summary of index.summaries) {
    const inputs = index.references
      .filter(
        (item) =>
          (item.kind === 'jsx' || item.kind === 'call') &&
          item.targets.some((target) => target.declarationId === index.componentDeclarationId),
      )
      .flatMap((item) => item.inputs.filter((input) => input.name === summary.inputName));
    for (const state of ['provided', 'omitted', 'unknown'] as const)
      if (summary.counts[state] !== inputs.filter((input) => input.state === state).length)
        return { status: 'corrupt' };
    for (const origin of ['fixed', 'forwarded'] as const)
      if (summary.counts[origin] !== inputs.filter((input) => input.origin === origin).length)
        return { status: 'corrupt' };
    for (const sample of summary.samples) {
      const reference = index.references.find((reference) => reference.id === sample.referenceId);
      const input = reference?.inputs.find((input) => input.name === summary.inputName);
      if (
        !input ||
        input.value !== sample.value ||
        identity(input.valueLocation ?? input.location) !== identity(sample.location) ||
        sample.violation !==
          (summary.constraint.kind === 'finite' && !summary.constraint.alternatives.includes(sample.value))
      )
        return { status: 'corrupt' };
    }
  }
  return { status: 'available', evidence: index };
}

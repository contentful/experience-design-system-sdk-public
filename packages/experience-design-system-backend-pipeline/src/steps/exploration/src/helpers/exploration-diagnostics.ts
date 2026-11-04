import type { KnownComponent } from '@contentful/experience-design-system-types';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Keep the machine path and add the actual subject from the draft, never an assumed array order. */
export function explorationIssueSubject(value: unknown, path: readonly PropertyKey[]): string {
  const machinePath = path.map(String).join('.') || 'report';
  if (!record(value) || !Array.isArray(value.components) || path[0] !== 'components' || typeof path[1] !== 'number')
    return machinePath;
  const component: unknown = value.components[path[1]];
  if (!record(component)) return machinePath;
  const owner = typeof component.name === 'string' ? component.name : `components[${path[1]}]`;
  const source = typeof component.source === 'string' ? ` (${component.source})` : '';
  const group = path[2];
  const fields = group === 'props' || group === 'slots' ? component[group] : undefined;
  const field: unknown = Array.isArray(fields) && typeof path[3] === 'number' ? fields[path[3]] : undefined;
  const subject =
    record(field) && typeof field.name === 'string'
      ? `${group === 'slots' ? 'slot' : 'property'}:${field.name}`
      : undefined;
  return `${owner}${source}${subject ? ` ${subject}` : ''} [${machinePath}]`;
}

export function explorationCoverageDiagnostic(
  requested: readonly KnownComponent[],
  reported: readonly KnownComponent[],
): string | undefined {
  const matches = (expected: KnownComponent, actual: KnownComponent) =>
    expected.name === actual.name &&
    expected.source === actual.source &&
    (expected.componentId === undefined || expected.componentId === actual.componentId);
  const missing = requested.filter((expected) => !reported.some((actual) => matches(expected, actual)));
  const unexpected = reported.filter((actual) => !requested.some((expected) => matches(expected, actual)));
  if (requested.length === reported.length && !missing.length && !unexpected.length) return undefined;
  return [
    'Exploration report must exactly cover assigned component/source identities.',
    `Expected ${requested.length} entries; received ${reported.length}.`,
    `Missing assigned identities: ${JSON.stringify(missing)}.`,
    `Unexpected or mismatched identities: ${JSON.stringify(unexpected)}.`,
    'Preserve exact assigned names, source paths and componentId values, including explicit entries for exclusions.',
  ].join(' ');
}

export function explorationWorkCoverage(expected: readonly string[], actual: readonly string[]): string {
  return [
    `Expected ${expected.length} entries; received ${actual.length}.`,
    `Missing IDs: ${JSON.stringify(expected.filter((id) => !actual.includes(id)))}.`,
    `Unexpected IDs: ${JSON.stringify(actual.filter((id) => !expected.includes(id)))}.`,
  ].join(' ');
}

import {
  parseClassificationToolLines,
  type NormalizedClassificationCalls,
} from '@contentful/experience-design-system-types';

const FAILING_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['Unknown tool', 'tool'],
  ['Missing exact property name', 'prop'],
  ['Missing exact slot name', 'slot'],
  ['Exclusion requires nonblank reason', 'reason'],
  ['Absent representation requires nonblank reason', 'reason'],
  ['Invalid allowed components', 'allowed_components'],
  ['Invalid component rationale', 'rationale'],
  ['Invalid semantic category', 'cdf_category'],
  ['Invalid representation type', 'cdf_type'],
  ['Token kind requires token representation', 'token_kind ($token.kind)'],
  ['Token options require a token mapping decision', 'values ($values)'],
  ['values must be an array', 'values ($values)'],
  ['Invalid or conflicting default intent', 'default_intent'],
];
const UNKNOWN_FIELD = /Unknown decision field: (.+)$/;

function failingField(issue: string): string | undefined {
  const unknown = UNKNOWN_FIELD.exec(issue);
  if (unknown) return unknown[1];
  return FAILING_FIELDS.find(([message]) => issue.endsWith(message))?.[1];
}

function nameFailingFields(warning: string): string {
  return warning
    .split('; ')
    .map((issue) => {
      const field = failingField(issue);
      return field ? `${issue} [field: ${field}]` : issue;
    })
    .join('; ');
}

export function parseToolCalls(
  stdout: string,
  onInvalidCall?: (message: string) => void,
): NormalizedClassificationCalls {
  const parsed = parseClassificationToolLines(stdout);
  const warnings = parsed.warnings.map(nameFailingFields);
  if (onInvalidCall) for (const warning of warnings) onInvalidCall(warning);
  return { calls: parsed.calls, warnings };
}

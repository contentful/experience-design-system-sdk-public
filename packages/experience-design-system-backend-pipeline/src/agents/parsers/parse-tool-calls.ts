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
];

function nameFailingField(warning: string): string {
  const match = FAILING_FIELDS.find(([message]) => warning.endsWith(message));
  return match ? `${warning} [field: ${match[1]}]` : warning;
}

export function parseToolCalls(
  stdout: string,
  onInvalidCall?: (message: string) => void,
): NormalizedClassificationCalls {
  const parsed = parseClassificationToolLines(stdout);
  const warnings = parsed.warnings.map(nameFailingField);
  if (onInvalidCall) for (const warning of warnings) onInvalidCall(warning);
  return { calls: parsed.calls, warnings };
}

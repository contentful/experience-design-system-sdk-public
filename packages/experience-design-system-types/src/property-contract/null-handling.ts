import { jsonValueIssue, type PropertyIssue } from './json-value.js';
import type { PropertySourceGraph } from './property-model.js';

export interface NullHandlingJudgment {
  sourceNodeId: string;
  handling: 'omit-equivalent' | 'distinct' | 'unknown';
  reason: string;
}

export function validateNullHandling(input: unknown): PropertyIssue[] {
  const unsafe = jsonValueIssue(input);
  if (unsafe) return [unsafe];
  if (!Array.isArray(input) || !input.length)
    return [{ path: '/null_handling', message: 'Null handling requires a nonempty judgment array' }];
  const issues: PropertyIssue[] = [];
  const seen = new Set<string>();
  for (const [index, value] of input.entries()) {
    const path = `/null_handling/${index}`;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !['sourceNodeId', 'handling', 'reason'].includes(key)) ||
      typeof value.sourceNodeId !== 'string' ||
      !value.sourceNodeId.trim() ||
      !['omit-equivalent', 'distinct', 'unknown'].includes(value.handling) ||
      typeof value.reason !== 'string' ||
      !value.reason.trim()
    ) {
      issues.push({ path, message: 'Invalid source-bound null-handling judgment' });
      continue;
    }
    if (seen.has(value.sourceNodeId)) issues.push({ path, message: 'Duplicate null-handling source node' });
    seen.add(value.sourceNodeId);
  }
  return issues;
}

export function validateNullHandlingSource(input: unknown, graph: PropertySourceGraph): PropertyIssue[] {
  const issues = validateNullHandling(input);
  if (issues.length) return issues;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const judgment of input as NullHandlingJudgment[]) {
    const node = nodes.get(judgment.sourceNodeId);
    const members = (node?.alternatives ?? []).map((id) => nodes.get(id));
    const nullableUnion = node?.kind === 'union' && members.some((member) => member?.kind === 'null');
    const declaredNullable =
      node?.nullable === true &&
      node.nullability?.null.state === 'present' &&
      ['compiler', 'syntax'].includes(node.nullability.null.source);
    if (!nullableUnion && !declaredNullable)
      issues.push({
        path: '/null_handling',
        message: 'Null judgment must reference a current positively nullable source node',
      });
    else if (
      judgment.handling === 'omit-equivalent' &&
      !(nullableUnion
        ? members.some((member) => member && !['null', 'undefined', 'never'].includes(member.kind))
        : node && !['null', 'undefined', 'never', 'unknown'].includes(node.kind))
    )
      issues.push({ path: '/null_handling', message: 'Null omission requires a non-null source alternative' });
  }
  return issues;
}

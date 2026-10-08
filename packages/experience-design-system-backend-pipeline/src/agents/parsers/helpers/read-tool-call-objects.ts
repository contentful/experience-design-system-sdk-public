import { findJsonObjectEnd } from './find-json-object-end.js';

/**
 * Reads an agent's stdout into the tool-call objects it carries. Lines that
 * do not start with `{` are the agent's prose and are skipped silently.
 */
export function readToolCallObjects(stdout: string): {
  objects: Array<Record<string, unknown>>;
  warnings: string[];
} {
  const objects: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;

    const end = findJsonObjectEnd(line);
    if (end === -1) {
      warnings.push(`unparseable line: ${line.slice(0, 120)}`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(0, end + 1));
    } catch {
      warnings.push(`unparseable line: ${line.slice(0, 120)}`);
      continue;
    }
    const trailing = line.slice(end + 1);
    if (trailing.trim()) {
      warnings.push(`ignored trailing content after JSON: ${trailing.trim().slice(0, 120)}`);
    }
    if (typeof parsed === 'object' && parsed !== null && 'tool' in parsed) {
      objects.push(parsed as Record<string, unknown>);
    }
  }

  return { objects, warnings };
}

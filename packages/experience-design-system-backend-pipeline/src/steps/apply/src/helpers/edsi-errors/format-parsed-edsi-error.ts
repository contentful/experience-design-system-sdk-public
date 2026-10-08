import type { ParsedEdsiError } from './types.js';

export function formatParsedEdsiError(parsed: ParsedEdsiError, opts: { verbose?: boolean; raw?: string } = {}): string {
  const lines: string[] = [];
  if (parsed.code) lines.push(`[${parsed.code}]`);
  if (parsed.message) lines.push(parsed.message);

  for (const diagnostic of parsed.diagnostics ?? []) {
    const context = [
      diagnostic.component ? `Component: ${diagnostic.component}` : null,
      diagnostic.path ? `Path: ${diagnostic.path}` : null,
    ].filter(Boolean);
    lines.push(`- ${diagnostic.message}${context.length > 0 ? ` (${context.join('; ')})` : ''}`);
    if (diagnostic.path === null) {
      lines.push(
        '  Location: not provided by the server. Review the submitted CDF file; no component or field was identified.',
      );
    }
    if (opts.verbose && diagnostic.messageSource) {
      lines.push(`  Message field: ${diagnostic.messageSource}`);
    }
  }

  if (parsed.code === 'BindingValidationFailed') {
    const location = parsed.diagnostics?.find((d) => d.path)?.path;
    lines.push(
      location
        ? `Next action: review the binding at ${location} and correct its pointer or GraphQL selection.`
        : 'Next action: review the binding pointer and GraphQL selection.',
    );
  }
  if (parsed.code === 'AccessDenied') {
    lines.push(
      'Next action: this operation requires DesignToken and Component permissions in this environment. Ask a Contentful admin to grant both on your role.',
    );
  }
  if (parsed.code === 'NotFound') {
    lines.push(
      'Next action: verify the resource id is correct. If it should exist, your role may lack read permission on DesignToken or Component.',
    );
  }
  if (parsed.cycle && parsed.cycle.length > 0) {
    lines.push(`Cycle: ${parsed.cycle.join(' → ')} → ${parsed.cycle[0]}`);
    lines.push('Break the cycle by removing at least one $allowedComponents entry.');
  }
  if (opts.verbose && opts.raw) {
    lines.push('');
    lines.push('--- raw ---');
    lines.push(opts.raw);
  }
  return lines.filter(Boolean).join('\n');
}

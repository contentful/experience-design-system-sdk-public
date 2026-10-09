export interface PreviewValidationError {
  componentName: string;
  path: string;
  message: string;
}

export function failedComponentNames(errors: readonly PreviewValidationError[]): string[] {
  return [...new Set(errors.map((error) => error.componentName))];
}

export function matchedComponentNames(
  errors: readonly PreviewValidationError[],
  missingNames: readonly string[],
): string[] {
  return failedComponentNames(errors).filter((name) => !missingNames.includes(name));
}

export function formatErrorLine(error: PreviewValidationError): string {
  const context = [`Component: ${error.componentName}`, error.path ? `Path: ${error.path}` : null].filter(Boolean);
  return `- ${error.message} (${context.join('; ')})`;
}

export function formatErrorLines(errors: readonly PreviewValidationError[]): string {
  return errors.map(formatErrorLine).join('\n');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function missingNote(missingNames: readonly string[]): string {
  if (missingNames.length === 0) return '';
  const verb = missingNames.length === 1 ? 'does' : 'do';
  return `\n\nNote: ${plural(missingNames.length, 'component name')} from the server (${missingNames.join(', ')}) ${verb} not match anything in this session — they cannot be edited or skipped from here.`;
}

export function contextText(errors: readonly PreviewValidationError[], missingNames: readonly string[]): string {
  const failed = failedComponentNames(errors);
  return `${plural(failed.length, 'component')} failed server validation. Edit their definitions in the review TUI, or skip them and retry preview without them.${missingNote(missingNames)}`;
}

export function skipLabel(matchedNames: readonly string[]): string {
  if (matchedNames.length === 0) return 'No matching components to skip';
  const target = matchedNames.length === 1 ? matchedNames[0] : `${matchedNames.length} components`;
  return `Skip ${target} and retry`;
}

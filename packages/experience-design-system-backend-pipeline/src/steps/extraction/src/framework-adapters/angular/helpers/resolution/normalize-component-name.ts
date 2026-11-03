const SUFFIXES = ['Component', 'Directive'];

export function normalizeComponentName(className: string): string {
  for (const suffix of SUFFIXES) {
    if (className.endsWith(suffix) && className.length > suffix.length) {
      return className.slice(0, -suffix.length);
    }
  }
  return className;
}

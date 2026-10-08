export function forwardedImportArgs(argv: string[]): string[] {
  return argv[0] === 'import' ? argv.slice(1) : argv;
}

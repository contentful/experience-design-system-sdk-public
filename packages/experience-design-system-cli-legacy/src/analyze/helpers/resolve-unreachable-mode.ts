export function resolveUnreachableMode(value: string | undefined): 'auto' | 'always' | 'never' {
  const v = value ?? 'auto';
  if (v !== 'auto' && v !== 'always' && v !== 'never') {
    process.stderr.write(`Error: --resolve-unreachable must be one of 'auto', 'always', 'never' (got '${v}')\n`);
    process.exit(1);
  }
  return v;
}

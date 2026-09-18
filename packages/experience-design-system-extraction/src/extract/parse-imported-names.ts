export function parseImportedNames(importClause: string): string[] {
  const trimmed = importClause.trim();
  if (!trimmed) return [];

  const names: string[] = [];
  const defaultAndNamed = trimmed.split(',').map((part) => part.trim());

  for (const part of defaultAndNamed) {
    if (!part) continue;
    if (part.startsWith('{') && part.endsWith('}')) {
      for (const named of part
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)) {
        const [local] = named.split(/\s+as\s+/i);
        if (local) names.push(local.trim());
      }
      continue;
    }

    const [local] = part.split(/\s+as\s+/i);
    if (local) names.push(local.trim());
  }

  return names;
}

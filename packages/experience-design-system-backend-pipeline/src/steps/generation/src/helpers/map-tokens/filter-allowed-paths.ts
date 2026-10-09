export function filterAllowedPaths(args: {
  component: string;
  prop: string;
  tokenAllowed: string[];
  tokenTypeByPath: Map<string, string>;
  propTokenKind: string | null;
  warnings: string[];
}): string[] {
  const { component, prop, tokenAllowed, tokenTypeByPath, propTokenKind, warnings } = args;
  const kept: string[] = [];
  for (const path of tokenAllowed) {
    const tokenType = tokenTypeByPath.get(path);
    if (tokenType === undefined) {
      warnings.push(`map_token_prop '${component}.${prop}': dropped unknown token path '${path}'`);
    } else if (propTokenKind !== null && tokenType !== propTokenKind) {
      warnings.push(
        `map_token_prop '${component}.${prop}': dropped '${path}' — it is a ${tokenType} token, but the property's $token.kind is ${propTokenKind}`,
      );
    } else {
      kept.push(path);
    }
  }
  return kept;
}

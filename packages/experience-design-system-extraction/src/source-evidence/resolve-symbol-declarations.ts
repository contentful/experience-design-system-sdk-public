import ts from 'typescript';

/** Follow compiler import aliases and immutable value aliases without spelling heuristics. */
export function resolveSourceSymbolDeclarations(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
  options: {
    admit?: (symbol: ts.Symbol) => boolean;
    alias?: (declaration: ts.Declaration, symbol: ts.Symbol) => void;
    cycle?: () => void;
  } = {},
  seen = new Set<ts.Symbol>(),
): ts.Declaration[] {
  if (!symbol) return [];
  if (seen.has(symbol)) {
    options.cycle?.();
    return [];
  }
  if (options.admit && !options.admit(symbol)) return [];
  seen.add(symbol);
  if (symbol.flags & ts.SymbolFlags.Alias) {
    for (const declaration of symbol.declarations ?? []) options.alias?.(declaration, symbol);
    return resolveSourceSymbolDeclarations(checker, checker.getAliasedSymbol(symbol), options, seen);
  }
  return (symbol.declarations ?? []).flatMap((declaration) => {
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      (ts.isIdentifier(declaration.initializer) || ts.isPropertyAccessExpression(declaration.initializer))
    ) {
      options.alias?.(declaration, symbol);
      return resolveSourceSymbolDeclarations(
        checker,
        checker.getSymbolAtLocation(declaration.initializer),
        options,
        new Set(seen),
      );
    }
    return [declaration];
  });
}

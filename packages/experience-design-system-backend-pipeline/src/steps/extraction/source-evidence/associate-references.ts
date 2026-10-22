import ts from 'typescript';
import { resolveSourceSymbolDeclarations } from './resolve-symbol-declarations.js';
import type {
  CapturedSourceFile,
  CapturedCompilerContext,
  SourceCaptureDiagnostic,
  SourceResolution,
} from './types.js';

/** Associate admitted lexical bindings and references without asserting execution. */
export function associateCapturedReferences(options: {
  files: CapturedSourceFile[];
  resolution: SourceResolution[];
  compilerContexts: CapturedCompilerContext[];
  componentPaths: ReadonlyMap<string, readonly { componentId: string; name: string }[]>;
  checkBudget: () => boolean;
  maxNodes: number;
  recordNodes: (nodes: number) => void;
}): SourceCaptureDiagnostic[] {
  const diagnostics: SourceCaptureDiagnostic[] = [];
  const files = new Map(
    options.files
      .filter((file) => file.captured.kind === 'full' && /\.[cm]?[jt]sx?$/.test(file.canonicalPath))
      .map((file) => [file.canonicalPath, file]),
  );
  const byId = new Map(options.files.map((file) => [file.fileId, file]));
  let nodes = 0,
    stopped = false;
  const groups = options.compilerContexts.map((context) => ({
    context,
    roots: [...files.values()]
      .filter((file) => file.compilerContextId === context.contextId)
      .map((file) => file.canonicalPath),
  }));
  for (const { context, roots } of groups) {
    if (!roots.length || stopped) continue;
    const sourceFiles = new Map<string, ts.SourceFile>();
    const host: ts.CompilerHost = {
      getSourceFile: (path, version) => {
        const file = files.get(path);
        if (!options.checkBudget() || !file || file.captured.kind !== 'full') return undefined;
        let source = sourceFiles.get(path);
        if (!source) {
          source = ts.createSourceFile(path, file.captured.text, version, true);
          sourceFiles.set(path, source);
        }
        return source;
      },
      getDefaultLibFileName: () => '',
      writeFile: () => undefined,
      getCurrentDirectory: () => '',
      getDirectories: () => [],
      getCanonicalFileName: (path) => path,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (path) => files.has(path),
      readFile: (path) => {
        const file = files.get(path);
        return file?.captured.kind === 'full' ? file.captured.text : undefined;
      },
      resolveModuleNames: (names, containingFile) =>
        names.map((name) => {
          const from = files.get(containingFile);
          const edge = options.resolution.find(
            (edge) => edge.fromFileId === from?.fileId && edge.specifier === name && edge.targetFileId,
          );
          const target = edge?.targetFileId ? byId.get(edge.targetFileId) : undefined;
          if (!target || !files.has(target.canonicalPath)) return undefined;
          return { resolvedFileName: target.canonicalPath, isExternalLibraryImport: false };
        }),
    };
    if (!options.checkBudget()) {
      stopped = true;
      break;
    }
    const program = ts.createProgram(roots, context.compilerOptions as ts.CompilerOptions, host);
    const checker = program.getTypeChecker();
    if (!options.checkBudget()) {
      stopped = true;
      break;
    }
    type Owner = { componentId: string; name: string };
    const declarations = new Map<ts.Declaration, Owner[]>();
    const resolveSymbol = (symbol: ts.Symbol | undefined): ts.Declaration[] =>
      resolveSourceSymbolDeclarations(checker, symbol);
    const add = (file: CapturedSourceFile, owner: Owner, roles: string[], node?: ts.Node): void => {
      let ref = file.componentRefs.find((ref) => ref.componentId === owner.componentId && ref.name === owner.name);
      if (!ref) {
        ref = { ...owner, roles: [] };
        file.componentRefs.push(ref);
      }
      ref.roles = [...new Set([...ref.roles, ...roles])].sort();
      file.roles = [...new Set([...file.roles, ...roles])].sort();
      if (node) {
        const source = node.getSourceFile();
        const startLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const endLine = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        for (const role of roles) {
          const observation = { role, startLine, endLine };
          ref.observations ??= [];
          if (
            !ref.observations.some(
              (item) => item.role === role && item.startLine === startLine && item.endLine === endLine,
            )
          )
            ref.observations.push(observation);
        }
      }
    };
    for (const [path, owners] of options.componentPaths) {
      const file = files.get(path),
        source = program.getSourceFile(path);
      if (!file || !source) continue;
      const module = checker.getSymbolAtLocation(source);
      const exports = module ? checker.getExportsOfModule(module) : [];
      for (const owner of owners) {
        const symbol =
          exports.find((symbol) => symbol.name === owner.name) ??
          checker.getSymbolsInScope(source, ts.SymbolFlags.Value).find((symbol) => symbol.name === owner.name) ??
          (owners.length === 1 ? exports.find((symbol) => symbol.name === 'default') : undefined);
        const resolved = resolveSymbol(symbol);
        if (!resolved.length) {
          const unresolved = file.componentRefs.find((ref) => ref.componentId === owner.componentId);
          if (unresolved) unresolved.roles = ['supplied-source'];
          if (!file.componentRefs.some((ref) => ref.roles.includes('definition')))
            file.roles = file.roles.filter((role) => role !== 'definition');
          diagnostics.push({
            kind: 'parse',
            fileId: file.fileId,
            reason: `component-association-unresolved:${owner.componentId}`,
          });
          continue;
        }
        for (const declaration of resolved) {
          const definition = files.get(declaration.getSourceFile().fileName);
          if (!definition) continue;
          const before = file.componentRefs.find((ref) => ref.componentId === owner.componentId);
          if (definition.fileId !== file.fileId && before) {
            before.roles = before.roles.filter((role) => role !== 'definition');
            if (!file.componentRefs.some((ref) => ref.roles.includes('definition')))
              file.roles = file.roles.filter((role) => role !== 'definition');
          }
          add(file, owner, definition.fileId === file.fileId ? ['definition'] : ['binding']);
          add(definition, owner, ['definition'], declaration);
          const values = declarations.get(declaration) ?? [];
          values.push(owner);
          declarations.set(declaration, values);
        }
      }
    }
    for (const [path, file] of files) {
      const source = program.getSourceFile(path);
      if (!source || stopped) continue;
      const visit = (node: ts.Node): void => {
        if (stopped) return;
        if (++nodes > options.maxNodes || (nodes % 128 === 0 && !options.checkBudget())) {
          stopped = true;
          return;
        }
        if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
          const symbol = checker.getSymbolAtLocation(node);
          const targets = resolveSymbol(symbol);
          const owners = targets.flatMap((declaration) => declarations.get(declaration) ?? []);
          const isDeclaration = targets.some((declaration) => (declaration as ts.NamedDeclaration).name === node);
          if (!isDeclaration)
            for (const owner of owners) {
              const parent = node.parent;
              const binding =
                ts.isImportSpecifier(parent) ||
                ts.isImportClause(parent) ||
                ts.isNamespaceImport(parent) ||
                ts.isExportSpecifier(parent) ||
                (ts.isVariableDeclaration(parent) &&
                  parent.name === node &&
                  !!parent.initializer &&
                  (ts.isIdentifier(parent.initializer) || ts.isPropertyAccessExpression(parent.initializer)));
              const jsx =
                ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent);
              const call = ts.isCallExpression(parent) && parent.expression === node;
              add(
                file,
                owner,
                binding
                  ? ['binding', 'reference']
                  : jsx
                    ? ['application', 'reference']
                    : call
                      ? ['caller', 'reference']
                      : ['reference'],
                node,
              );
            }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  options.recordNodes(Math.min(nodes, options.maxNodes));
  if (!options.checkBudget()) stopped = true;
  if (stopped) diagnostics.push({ kind: 'budget', reason: 'reference-association-budget' });
  for (const [path] of options.componentPaths) {
    if (files.has(path)) continue;
    const captured = options.files.find((file) => file.canonicalPath === path);
    if (!captured || captured.captured.kind !== 'full') continue;
    for (const ref of captured.componentRefs) ref.roles = ['supplied-source'];
    captured.roles = [
      ...new Set([...captured.roles.filter((role) => role !== 'definition'), 'supplied-source']),
    ].sort();
    diagnostics.push({
      kind: 'parse',
      fileId: captured.fileId,
      reason: 'component-association-unsupported-or-unavailable',
    });
  }
  for (const file of options.files)
    file.componentRefs.sort((a, b) => a.componentId.localeCompare(b.componentId) || a.name.localeCompare(b.name));
  return diagnostics;
}

import { Node, Project, ScriptTarget, ModuleKind } from 'ts-morph';
import type { AstNode } from '../types/svelte-ast-node.js';
import { resolveLocalModule } from '../../shared/helpers/resolve-import-file-path.js';
import type { ResolvedTypeMember } from './extract-svelte-ast-type-members.js';
import {
  collectSnippetLocalsFromSourceFile,
  readInterfaceMembers,
  readTypeLiteralMembers,
} from './extract-svelte-external-type-members.js';

function readMembersFromExternalFile(filePath: string, exportName: string): ResolvedTypeMember[] | null {
  const project = new Project({
    compilerOptions: {
      strict: false,
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      allowJs: true,
    },
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  });
  const sf = project.addSourceFileAtPathIfExists(filePath);
  if (!sf) return null;

  const snippetLocals = collectSnippetLocalsFromSourceFile(sf);
  const decls = sf.getExportedDeclarations().get(exportName);
  if (!decls || decls.length === 0) return null;

  for (const decl of decls) {
    if (Node.isInterfaceDeclaration(decl)) {
      const declSf = decl.getSourceFile();
      return readInterfaceMembers(decl, declSf === sf ? snippetLocals : collectSnippetLocalsFromSourceFile(declSf));
    }
    if (Node.isTypeAliasDeclaration(decl)) {
      const typeNode = decl.getTypeNode();
      if (typeNode && Node.isTypeLiteral(typeNode)) {
        const declSf = decl.getSourceFile();
        return readTypeLiteralMembers(
          typeNode,
          declSf === sf ? snippetLocals : collectSnippetLocalsFromSourceFile(declSf),
        );
      }
    }
  }
  return null;
}

export async function resolveImportedTypeMembers(
  typeName: string,
  instance: AstNode,
  filePath: string,
): Promise<ResolvedTypeMember[] | null> {
  const body = (instance['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return null;

  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const specifierValue = (stmt['source'] as AstNode | undefined)?.['value'] as string | undefined;
    if (!specifierValue || !specifierValue.startsWith('.')) continue;

    const specifiers = (stmt['specifiers'] as AstNode[] | undefined) ?? [];
    let importedExport: string | null = null;
    for (const spec of specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      const localName = (spec['local'] as AstNode | undefined)?.['name'] as string | undefined;
      if (localName === typeName) {
        importedExport = ((spec['imported'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
        break;
      }
    }
    if (!importedExport) continue;

    const resolvedFile = resolveLocalModule(filePath, specifierValue, {
      allowJavaScriptExtensionFallback: true,
    });
    if (!resolvedFile) continue;
    return readMembersFromExternalFile(resolvedFile, importedExport);
  }
  return null;
}

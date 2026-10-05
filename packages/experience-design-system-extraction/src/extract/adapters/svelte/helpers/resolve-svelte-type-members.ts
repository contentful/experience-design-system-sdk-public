import { Node, Project, ScriptTarget, ModuleKind, ts } from 'ts-morph';
import type { AstNode } from '../ast.js';
import { resolveLocalModule } from '../../support/resolution/local-module.js';
import {
  collectSnippetImportLocals,
  findLocalTypeDeclaration,
  declarationHasHeritage,
  mergeSets,
} from './traverse-svelte-ast.js';
import {
  isSnippetTypeText,
  isSnippetType,
  collectStringLiteralUnion,
  extractJsdocText,
  renderType,
  extractAllowedValuesFromText,
} from './render-svelte-type.js';

export interface ResolvedTypeMember {
  name: string;
  optional: boolean;
  typeText: string;
  declaredTypeText?: string;
  isSnippet: boolean;
  allowedValues?: string[];
  description?: string;
  line?: number;
  endLine?: number;
}

interface Comment {
  type: 'Line' | 'Block';
  value: string;
}

function sliceSource(source: string, node: AstNode): string | null {
  const start = (node['start'] as number | undefined) ?? null;
  const end = (node['end'] as number | undefined) ?? null;
  if (start == null || end == null) return null;
  return source.slice(start, end);
}

function sliceScriptContent(source: string, script: AstNode | undefined): string | null {
  if (!script) return null;
  const content = script['content'] as AstNode | undefined;
  if (!content) return null;
  return sliceSource(source, content);
}

function extractAllowedValuesFromType(type: import('ts-morph').Type): string[] | undefined {
  if (!type.isUnion()) return undefined;
  const out: string[] = [];
  for (const t of type.getUnionTypes()) {
    if (!t.isStringLiteral()) return undefined;
    out.push(t.getLiteralValueOrThrow() as string);
  }
  return out.length > 0 ? out : undefined;
}

function readJsDocFromDeclaration(decl: import('ts-morph').Node): string | undefined {
  if (Node.isPropertySignature(decl) || Node.isInterfaceDeclaration(decl) || Node.isTypeAliasDeclaration(decl)) {
    const jsdocs = decl.getJsDocs();
    if (jsdocs.length > 0) return jsdocs[0]!.getDescription().trim() || undefined;
  }
  return undefined;
}

function readDeclaredTypeNodeText(decl: import('ts-morph').Node): string | null {
  if (Node.isPropertySignature(decl)) {
    return decl.getTypeNode()?.getText() ?? null;
  }
  return null;
}

function typeRefersToSnippet(propType: import('ts-morph').Type): boolean {
  type TsMorphType = import('ts-morph').Type;
  const seen = new Set<TsMorphType>();
  let cursor: TsMorphType | undefined = propType;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const aliasName = cursor.getAliasSymbol()?.getName();
    const symName = cursor.getSymbol()?.getName();
    if (aliasName === 'Snippet' || symName === 'Snippet') {
      const decl = cursor.getAliasSymbol()?.getDeclarations()[0] ?? cursor.getSymbol()?.getDeclarations()[0];
      const file = decl?.getSourceFile().getFilePath() ?? '';
      if (file.includes('/svelte/') || file.includes('\\svelte\\') || file === '') return true;
    }
    if (cursor.isUnion()) {
      const nonUndef: TsMorphType[] = cursor.getUnionTypes().filter((t) => !t.isUndefined() && !t.isNull());
      if (nonUndef.length === 1) {
        cursor = nonUndef[0];
        continue;
      }
    }
    break;
  }
  return false;
}

function collectSnippetLocalsFromSourceFile(sf: import('ts-morph').SourceFile): Set<string> {
  const locals = new Set<string>();
  for (const importDecl of sf.getImportDeclarations()) {
    if (importDecl.getModuleSpecifierValue() !== 'svelte') continue;
    for (const named of importDecl.getNamedImports()) {
      if (named.getName() === 'Snippet') {
        const aliasNode = named.getAliasNode();
        locals.add(aliasNode ? aliasNode.getText() : named.getName());
      }
    }
  }
  return locals;
}

function readInterfaceMembers(
  iface: import('ts-morph').InterfaceDeclaration,
  snippetLocals: Set<string>,
): ResolvedTypeMember[] {
  return iface.getProperties().map((prop) => {
    const typeNode = prop.getTypeNode();
    const typeText = typeNode ? typeNode.getText() : prop.getType().getText(prop);
    const allowed = extractAllowedValuesFromText(typeText);
    const jsdocs = prop.getJsDocs();
    const description = jsdocs.length > 0 ? jsdocs[0]!.getDescription().trim() : undefined;
    return {
      name: prop.getName(),
      optional: prop.hasQuestionToken(),
      typeText,
      isSnippet: isSnippetTypeText(typeText, snippetLocals),
      ...(allowed ? { allowedValues: allowed } : {}),
      ...(description ? { description } : {}),
      line: prop.getStartLineNumber(),
      endLine: prop.getEndLineNumber(),
    } satisfies ResolvedTypeMember;
  });
}

function readTypeLiteralMembers(
  typeNode: import('ts-morph').TypeLiteralNode,
  snippetLocals: Set<string>,
): ResolvedTypeMember[] {
  return typeNode.getMembers().flatMap((m) => {
    if (!Node.isPropertySignature(m)) return [];
    const tn = m.getTypeNode();
    const typeText = tn ? tn.getText() : 'unknown';
    const allowed = extractAllowedValuesFromText(typeText);
    const jsdocs = m.getJsDocs();
    const description = jsdocs.length > 0 ? jsdocs[0]!.getDescription().trim() : undefined;
    return [
      {
        name: m.getName(),
        optional: m.hasQuestionToken(),
        typeText,
        isSnippet: isSnippetTypeText(typeText, snippetLocals),
        ...(allowed ? { allowedValues: allowed } : {}),
        ...(description ? { description } : {}),
        line: m.getStartLineNumber(),
        endLine: m.getEndLineNumber(),
      } satisfies ResolvedTypeMember,
    ];
  });
}

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
  const exportedDeclarations = sf.getExportedDeclarations();
  const decls = exportedDeclarations.get(exportName);
  if (!decls || decls.length === 0) return null;

  for (const decl of decls) {
    if (Node.isInterfaceDeclaration(decl)) {
      const declSf = decl.getSourceFile();
      const declLocals = declSf === sf ? snippetLocals : collectSnippetLocalsFromSourceFile(declSf);
      return readInterfaceMembers(decl, declLocals);
    }
    if (Node.isTypeAliasDeclaration(decl)) {
      const typeNode = decl.getTypeNode();
      if (typeNode && Node.isTypeLiteral(typeNode)) {
        const declSf = decl.getSourceFile();
        const declLocals = declSf === sf ? snippetLocals : collectSnippetLocalsFromSourceFile(declSf);
        return readTypeLiteralMembers(typeNode, declLocals);
      }
    }
  }

  return null;
}

async function resolveImportedTypeMembers(
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

    const resolvedFile = resolveLocalModule(filePath, specifierValue, { allowJavaScriptExtensionFallback: true });
    if (!resolvedFile) continue;

    return readMembersFromExternalFile(resolvedFile, importedExport);
  }
  return null;
}

export function readMembersFromInterfaceOrAlias(decl: AstNode, snippetLocals: Set<string>): ResolvedTypeMember[] {
  if (decl.type === 'TSInterfaceDeclaration') {
    const body = (decl['body'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
    if (!body) return [];
    return body.map((m) => readPropertySignature(m, snippetLocals)).filter((m): m is ResolvedTypeMember => !!m);
  }
  if (decl.type === 'TSTypeAliasDeclaration') {
    const ann = decl['typeAnnotation'] as AstNode | undefined;
    if (ann?.type === 'TSTypeLiteral') return readMembersFromTypeLiteral(ann, snippetLocals);
  }
  return [];
}

export function readMembersFromTypeLiteral(literal: AstNode, snippetLocals: Set<string>): ResolvedTypeMember[] {
  const members = literal['members'] as AstNode[] | undefined;
  if (!members) return [];
  return members.map((m) => readPropertySignature(m, snippetLocals)).filter((m): m is ResolvedTypeMember => !!m);
}

export function readPropertySignature(member: AstNode, snippetLocals: Set<string>): ResolvedTypeMember | null {
  if (member.type !== 'TSPropertySignature') return null;
  const key = member['key'] as AstNode | undefined;
  const name = (key?.['name'] as string | undefined) ?? null;
  if (!name) return null;
  const optional = !!member['optional'];
  const typeNode = (member['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
  const typeText = renderType(typeNode);
  const isSnippet = isSnippetType(typeNode, snippetLocals);
  const allowedValues = collectStringLiteralUnion(typeNode);

  const leading = (member['leadingComments'] as Comment[] | undefined) ?? [];
  const description = extractJsdocText(leading);

  return {
    name,
    optional,
    typeText,
    isSnippet,
    allowedValues,
    description,
    line: member.loc?.start?.line,
    endLine: member.loc?.end?.line,
  };
}

export async function resolveViaTypeChecker(
  annotation: AstNode,
  instance: AstNode,
  moduleScript: AstNode | undefined,
  filePath: string,
  source: string,
  snippetLocals: Set<string>,
  externalProject?: Project,
): Promise<ResolvedTypeMember[] | null> {
  const annotationText = sliceSource(source, annotation);
  if (!annotationText) return null;

  const moduleText = sliceScriptContent(source, moduleScript);
  const instanceText = sliceScriptContent(source, instance);
  const synthetic = [moduleText, instanceText, `type __SveltePropsT__ = ${annotationText};`].filter(Boolean).join('\n');

  const project =
    externalProject ??
    new Project({
      compilerOptions: {
        strict: false,
        target: ScriptTarget.ESNext,
        module: ModuleKind.ESNext,
        allowJs: true,
        jsx: ts.JsxEmit.Preserve,
      },
      useInMemoryFileSystem: false,
      skipAddingFilesFromTsConfig: true,
    });
  const syntheticPath = `${filePath}.__svelte-props__.ts`;
  let sf: import('ts-morph').SourceFile;
  try {
    sf = project.createSourceFile(syntheticPath, synthetic, { overwrite: true });
  } catch {
    return null;
  }

  const alias = sf.getTypeAlias('__SveltePropsT__');
  if (!alias) return null;

  const type = alias.getType();
  const apparent = type.getApparentType();
  const properties = apparent.getProperties();
  if (properties.length === 0) return null;

  const members: ResolvedTypeMember[] = [];
  for (const symbol of properties) {
    const name = symbol.getName();
    const declaration = symbol.getValueDeclaration() ?? symbol.getDeclarations()[0];
    if (!declaration) continue;

    const propType = symbol.getTypeAtLocation(declaration);
    let typeText = propType.getText(declaration);
    const optional = symbol.isOptional();
    if (optional) {
      typeText = typeText.replace(/\s*\|\s*undefined$/, '').replace(/^undefined\s*\|\s*/, '');
    }

    const allowed = extractAllowedValuesFromType(propType);
    const description = readJsDocFromDeclaration(declaration);
    const declaredTypeText = readDeclaredTypeNodeText(declaration);
    const isSnippet =
      (declaredTypeText !== null && isSnippetTypeText(declaredTypeText, snippetLocals)) ||
      typeRefersToSnippet(propType) ||
      isSnippetTypeText(typeText, snippetLocals);

    members.push({
      name,
      optional,
      typeText,
      ...(declaredTypeText ? { declaredTypeText } : {}),
      isSnippet,
      ...(allowed ? { allowedValues: allowed } : {}),
      ...(description ? { description } : {}),
    });
  }
  return members;
}

export async function resolveTypeMembers(
  annotation: AstNode,
  instance: AstNode,
  moduleScript: AstNode | undefined,
  filePath: string,
  source: string,
): Promise<ResolvedTypeMember[] | null> {
  const snippetLocals = mergeSets(
    collectSnippetImportLocals(instance),
    moduleScript ? collectSnippetImportLocals(moduleScript) : new Set<string>(),
  );

  if (annotation.type === 'TSTypeLiteral') {
    return readMembersFromTypeLiteral(annotation, snippetLocals);
  }

  if (annotation.type === 'TSTypeReference') {
    const refName = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    if (refName) {
      const local = findLocalTypeDeclaration(instance, refName, moduleScript);
      if (local) {
        const fastPathMembers = readMembersFromInterfaceOrAlias(local, snippetLocals);
        if (fastPathMembers.length > 0 && !declarationHasHeritage(local)) {
          return fastPathMembers;
        }
      } else {
        const imported =
          (await resolveImportedTypeMembers(refName, instance, filePath)) ??
          (moduleScript ? await resolveImportedTypeMembers(refName, moduleScript, filePath) : null);
        if (imported) return imported;
      }
    }
  }

  return resolveViaTypeChecker(annotation, instance, moduleScript, filePath, source, snippetLocals);
}

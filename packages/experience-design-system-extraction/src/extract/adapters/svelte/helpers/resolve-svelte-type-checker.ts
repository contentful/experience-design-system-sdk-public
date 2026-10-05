import { Project, ScriptTarget, ModuleKind, ts } from 'ts-morph';
import type { AstNode } from '../ast.js';
import { isSnippetTypeText } from './render-svelte-type.js';
import type { ResolvedTypeMember } from './resolve-svelte-ast-member-readers.js';
import {
  sliceSource,
  sliceScriptContent,
  extractAllowedValuesFromType,
  readJsDocFromDeclaration,
  readDeclaredTypeNodeText,
  typeRefersToSnippet,
} from './resolve-svelte-type-checker-helpers.js';

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

  const project = externalProject ?? new Project({
    compilerOptions: { strict: false, target: ScriptTarget.ESNext, module: ModuleKind.ESNext, allowJs: true, jsx: ts.JsxEmit.Preserve },
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

  const apparent = alias.getType().getApparentType();
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
    if (optional) typeText = typeText.replace(/\s*\|\s*undefined$/, '').replace(/^undefined\s*\|\s*/, '');

    const allowed = extractAllowedValuesFromType(propType);
    const description = readJsDocFromDeclaration(declaration);
    const declaredTypeText = readDeclaredTypeNodeText(declaration);
    const isSnippet =
      (declaredTypeText !== null && isSnippetTypeText(declaredTypeText, snippetLocals)) ||
      typeRefersToSnippet(propType) ||
      isSnippetTypeText(typeText, snippetLocals);

    members.push({
      name, optional, typeText,
      ...(declaredTypeText ? { declaredTypeText } : {}),
      isSnippet,
      ...(allowed ? { allowedValues: allowed } : {}),
      ...(description ? { description } : {}),
    });
  }
  return members;
}

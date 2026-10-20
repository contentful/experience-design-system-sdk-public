import { basename, dirname, join, resolve } from 'node:path';
import { Project, Node, SyntaxKind, type SourceFile, type ClassDeclaration } from 'ts-morph';
import type {
  RawComponentDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
  ExtractorProgress,
  ExtractorOptions,
} from '../../types/component.js';
import {
  collectWebComponentClasses,
  createWebComponentCompilerContexts,
  readWebComponentSyntax,
  SOURCE_FACT_SCHEMA_VERSION,
} from '@contentful/experience-design-system-extraction';
import { kebabToPascal } from '../shared/extract-tsx-components.js';

function normalizeComponentName(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function camelToKebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function resolveDecoratorInterpolation(node: Node): string | null {
  if (Node.isIdentifier(node)) {
    const definitions = node.getDefinitions();
    for (const definition of definitions) {
      const declarationNode = definition.getDeclarationNode();
      if (!declarationNode) continue;

      if (Node.isVariableDeclaration(declarationNode)) {
        const initializer = declarationNode.getInitializer();
        if (initializer && Node.isStringLiteral(initializer)) {
          return initializer.getLiteralValue();
        }
      }
    }

    const text = node.getText();
    if (/Prefix$/.test(text)) {
      return camelToKebab(text.replace(/Prefix$/, ''));
    }
  }

  return null;
}

function resolveDecoratorTagArgument(node: Node): string | null {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }

  if (!Node.isTemplateExpression(node)) {
    return null;
  }

  let resolved = node.getHead().getLiteralText();
  for (const span of node.getTemplateSpans()) {
    const interpolation = resolveDecoratorInterpolation(span.getExpression());
    if (!interpolation) {
      return null;
    }

    resolved += interpolation;
    resolved += span.getLiteral().getLiteralText();
  }

  return resolved;
}

function loadSourceFile(project: Project, filePath: string): SourceFile | null {
  let sourceFile = project.getSourceFile(filePath);
  if (sourceFile) return sourceFile;

  try {
    sourceFile = project.addSourceFileAtPath(filePath);
    return sourceFile;
  } catch {
    return null;
  }
}

function resolveImportSpecifierSource(
  declarationNode: Node,
  sourceFile: SourceFile,
  project: Project,
): { sourceFile: SourceFile; importedName: string } | undefined {
  if (!Node.isImportSpecifier(declarationNode)) return undefined;

  const importDecl = declarationNode.getImportDeclaration();
  const resolvedImportPath = resolveImportSourcePath(sourceFile.getFilePath(), importDecl.getModuleSpecifierValue());
  if (!resolvedImportPath) return undefined;

  const importedFile = loadSourceFile(project, resolvedImportPath);
  if (!importedFile) return undefined;

  return {
    sourceFile: importedFile,
    importedName: declarationNode.getNameNode().getText(),
  };
}

function resolveStaticStringExpression(
  node: Node | undefined,
  sourceFile: SourceFile,
  project: Project,
): string | null {
  if (!node) return null;

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }

  if (Node.isTemplateExpression(node)) {
    let resolved = node.getHead().getLiteralText();

    for (const span of node.getTemplateSpans()) {
      const interpolation = resolveStaticStringExpression(span.getExpression(), sourceFile, project);
      if (!interpolation) return null;

      resolved += interpolation;
      resolved += span.getLiteral().getLiteralText();
    }

    return resolved;
  }

  if (Node.isIdentifier(node)) {
    for (const definition of node.getDefinitions()) {
      const declarationNode = definition.getDeclarationNode();
      if (!declarationNode) continue;

      if (Node.isVariableDeclaration(declarationNode)) {
        const resolved = resolveStaticStringExpression(
          declarationNode.getInitializer(),
          declarationNode.getSourceFile(),
          project,
        );
        if (resolved) return resolved;
      }

      if (Node.isImportSpecifier(declarationNode)) {
        const importedSource = resolveImportSpecifierSource(declarationNode, sourceFile, project);
        if (!importedSource) continue;

        const importedDeclaration = importedSource.sourceFile.getVariableDeclaration(importedSource.importedName);
        if (!importedDeclaration) continue;

        const resolved = resolveStaticStringExpression(
          importedDeclaration.getInitializer(),
          importedSource.sourceFile,
          project,
        );
        if (resolved) return resolved;
      }
    }

    const text = node.getText();
    if (/Prefix$/.test(text)) {
      return camelToKebab(text.replace(/Prefix$/, ''));
    }

    return null;
  }

  if (Node.isPropertyAccessExpression(node)) {
    const target = node.getExpression();
    if (!Node.isIdentifier(target)) return null;

    const propertyName = node.getName();
    for (const definition of target.getDefinitions()) {
      const declarationNode = definition.getDeclarationNode();
      if (!declarationNode) continue;

      let variableDeclaration;
      if (Node.isVariableDeclaration(declarationNode)) {
        variableDeclaration = declarationNode;
      } else if (Node.isImportSpecifier(declarationNode)) {
        const importedSource = resolveImportSpecifierSource(declarationNode, sourceFile, project);
        if (!importedSource) continue;
        variableDeclaration = importedSource.sourceFile.getVariableDeclaration(importedSource.importedName);
      }

      if (!variableDeclaration) continue;

      let objectLiteral = variableDeclaration.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
      const initializer = variableDeclaration.getInitializer();
      if (
        !objectLiteral &&
        initializer &&
        Node.isCallExpression(initializer) &&
        initializer.getExpression().getText() === 'Object.freeze'
      ) {
        objectLiteral = initializer.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression) ?? undefined;
      }

      const property = objectLiteral
        ?.getProperties()
        .find(
          (prop): prop is import('ts-morph').PropertyAssignment =>
            Node.isPropertyAssignment(prop) && prop.getName() === propertyName,
        );
      if (!property) continue;

      const resolved = resolveStaticStringExpression(
        property.getInitializer(),
        variableDeclaration.getSourceFile(),
        project,
      );
      if (resolved) return resolved;
    }
  }

  return null;
}

function shouldPreferTagName(className: string, tagName: string): boolean {
  const pascalTagName = kebabToPascal(tagName);

  if (className.startsWith('HTML') && className.endsWith('Element')) return true;
  if (className.endsWith('Element')) return true;
  if (normalizeComponentName(className) === normalizeComponentName(pascalTagName)) return false;

  return false;
}

function getFileDerivedComponentName(sourceFile: SourceFile): string {
  const baseName = basename(sourceFile.getFilePath())
    .replace(/\.[^.]+$/, '')
    .replace(/\.component$/, '');
  return kebabToPascal(baseName);
}

function chooseComponentName(classDecl: ClassDeclaration, className: string, tagName: string | undefined): string {
  if (!tagName) return className;

  const tagDerivedName = kebabToPascal(tagName);
  const fileDerivedName = getFileDerivedComponentName(classDecl.getSourceFile());

  if (normalizeComponentName(className) === normalizeComponentName(tagDerivedName)) {
    return className;
  }

  if (normalizeComponentName(className) === normalizeComponentName(fileDerivedName)) {
    return className;
  }

  if (fileDerivedName && tagDerivedName.endsWith(fileDerivedName)) {
    return fileDerivedName;
  }

  if (shouldPreferTagName(className, tagName)) {
    return tagDerivedName;
  }

  return className;
}

function extractSlotsFromTemplate(templateContent: string): RawSlotDefinition[] {
  const slots = new Map<string, boolean>();
  const slotRegex = /<slot\b([^>]*)>/g;

  for (const match of templateContent.matchAll(slotRegex)) {
    const attrs = match[1] ?? '';
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/);
    const name = nameMatch?.[1] ?? 'default';
    slots.set(name, name === 'default');
  }

  return [...slots.entries()]
    .map(([name, isDefault]) => ({ name, isDefault }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mergeSlotLists(...slotLists: RawSlotDefinition[][]): RawSlotDefinition[] {
  const merged = new Map<string, RawSlotDefinition>();

  for (const slotList of slotLists) {
    for (const slot of slotList) {
      const existing = merged.get(slot.name);
      if (!existing) {
        merged.set(slot.name, slot);
        continue;
      }

      merged.set(slot.name, {
        ...existing,
        ...slot,
        description: existing.description ?? slot.description,
      });
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function collectHtmlTaggedTemplates(root: Node): string[] {
  const templates: string[] = [];

  root.forEachDescendant((node) => {
    if (!Node.isTaggedTemplateExpression(node)) return;

    const tag = node.getTag();
    if (tag.getText() !== 'html') return;

    const template = node.getTemplate();
    if (Node.isNoSubstitutionTemplateLiteral(template) || Node.isTemplateExpression(template)) {
      templates.push(template.getText().slice(1, -1));
    }
  });

  return templates;
}

function collectHtmlTaggedTemplatesWithHelpers(root: Node, project: Project): string[] {
  const templates = [...collectHtmlTaggedTemplates(root)];
  const seenTemplateHelpers = new Set<string>();

  root.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    for (const declaration of resolveTemplateHelperDeclarations(node, project)) {
      const helperKey = `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`;
      if (seenTemplateHelpers.has(helperKey)) continue;
      seenTemplateHelpers.add(helperKey);

      templates.push(...collectHtmlTaggedTemplates(declaration));
    }
  });

  return templates;
}

function resolveTemplateHelperDeclarations(
  callExpression: import('ts-morph').CallExpression,
  project: Project,
): Node[] {
  const expression = callExpression.getExpression();
  if (!Node.isIdentifier(expression)) return [];

  const declarations: Node[] = [];
  for (const definition of expression.getDefinitions()) {
    const declarationNode = definition.getDeclarationNode();
    if (!declarationNode) continue;

    if (Node.isFunctionDeclaration(declarationNode) || Node.isVariableDeclaration(declarationNode)) {
      declarations.push(declarationNode);
      continue;
    }

    if (!Node.isImportSpecifier(declarationNode)) continue;

    const importDecl = declarationNode.getImportDeclaration();
    const resolvedImportPath = resolveImportSourcePath(
      callExpression.getSourceFile().getFilePath(),
      importDecl.getModuleSpecifierValue(),
    );
    if (!resolvedImportPath) continue;

    const importedFile = loadSourceFile(project, resolvedImportPath);
    if (!importedFile) continue;

    const importedName = declarationNode.getNameNode().getText();
    const importedFunction = importedFile.getFunction(importedName);
    if (importedFunction) {
      declarations.push(importedFunction);
      continue;
    }

    const importedVariable = importedFile.getVariableDeclaration(importedName);
    if (importedVariable) {
      declarations.push(importedVariable);
    }
  }

  return declarations;
}

function extractFastTemplateSlots(classDecl: ClassDeclaration, project: Project): RawSlotDefinition[] {
  const sourceFilePath = classDecl.getSourceFile().getFilePath();
  if (!sourceFilePath.endsWith('.ts') || sourceFilePath.endsWith('.template.ts')) {
    return [];
  }

  const templatePath = `${sourceFilePath.slice(0, -'.ts'.length)}.template.ts`;
  const templateFile = loadSourceFile(project, templatePath);
  if (!templateFile) {
    return [];
  }

  const fragments: string[] = [];
  fragments.push(...collectHtmlTaggedTemplatesWithHelpers(templateFile, project));

  return extractSlotsFromTemplate(fragments.join('\n'));
}

function getElementTagNameFromJsDoc(classDecl: ClassDeclaration): string | null {
  for (const doc of classDecl.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() !== 'element') continue;
      const comment = tag.getCommentText();
      if (comment) {
        return comment.trim();
      }
    }
  }
  return null;
}

function getElementTagNameFromDecorator(classDecl: ClassDeclaration): string | null {
  for (const decorator of classDecl.getDecorators()) {
    if (decorator.getName() !== 'customElement') continue;

    const firstArg = decorator.getArguments()[0];
    if (!firstArg) continue;

    const resolved = resolveDecoratorTagArgument(firstArg);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function getElementTagNameFromSiblingDefine(classDecl: ClassDeclaration, project: Project): string | null {
  const sourceFilePath = classDecl.getSourceFile().getFilePath();
  if (!sourceFilePath.endsWith('.component.ts')) {
    return null;
  }

  const siblingPath = `${sourceFilePath.slice(0, -'.component.ts'.length)}.ts`;
  let siblingFile = project.getSourceFile(siblingPath);
  if (!siblingFile) {
    try {
      siblingFile = project.addSourceFileAtPath(siblingPath);
    } catch {
      return null;
    }
  }

  const className = classDecl.getName();
  if (!className) return null;

  for (const node of siblingFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = node.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    if (expression.getName() !== 'define') continue;
    if (expression.getExpression().getText() !== className) continue;

    const tagArg = node.getArguments()[0];
    if (!tagArg || !Node.isStringLiteral(tagArg)) continue;
    return tagArg.getLiteralValue();
  }

  return null;
}

function getElementTagNameFromFastDefinition(classDecl: ClassDeclaration, project: Project): string | null {
  const sourceFilePath = classDecl.getSourceFile().getFilePath();
  if (!sourceFilePath.endsWith('.ts') || sourceFilePath.endsWith('.definition.ts')) {
    return null;
  }

  const definitionPath = `${sourceFilePath.slice(0, -'.ts'.length)}.definition.ts`;
  const definitionFile = loadSourceFile(project, definitionPath);
  if (!definitionFile) {
    return null;
  }

  for (const callExpr of definitionFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpr.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    if (expression.getName() !== 'compose') continue;

    const options = callExpr.getArguments()[0];
    if (!options || !Node.isObjectLiteralExpression(options)) continue;

    const nameProperty = options
      .getProperties()
      .find(
        (prop): prop is import('ts-morph').PropertyAssignment =>
          Node.isPropertyAssignment(prop) && (prop.getName() === 'name' || prop.getName() === 'baseName'),
      );
    if (!nameProperty) continue;

    const resolved = resolveStaticStringExpression(nameProperty.getInitializer(), definitionFile, project);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveImportSourcePath(fromFilePath: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const resolvedPath = resolve(dirname(fromFilePath), specifier);
    if (resolvedPath.endsWith('.js')) {
      return `${resolvedPath.slice(0, -3)}.ts`;
    }
    return resolvedPath;
  }

  const spectrumPrefix = '@spectrum-web-components/core/components/';
  if (!specifier.startsWith(spectrumPrefix)) {
    return null;
  }

  const packagesMarker = `${join('2nd-gen', 'packages')}${fromFilePath.includes('\\') ? '\\' : '/'}`;
  const markerIndex = fromFilePath.lastIndexOf(packagesMarker);
  if (markerIndex === -1) {
    return null;
  }

  const packagesRoot = fromFilePath.slice(0, markerIndex + packagesMarker.length - 1);
  const componentPath = specifier.slice(spectrumPrefix.length);
  return join(packagesRoot, 'core', 'components', componentPath, 'index.ts');
}

function buildTagNameMap(sourceFile: SourceFile): Map<string, string> {
  // Maps class name → tag name from customElements.define('tag-name', ClassName) calls
  const tagNameMap = new Map<string, string>();

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;
    if (expr.getName() !== 'define') return;

    const obj = expr.getExpression();
    if (obj.getText() !== 'customElements') return;

    const args = node.getArguments();
    if (args.length < 2) return;

    const tagArg = args[0];
    const classArg = args[1];

    if (!Node.isStringLiteral(tagArg)) return;

    const tagName = tagArg.getLiteralValue();
    const className = classArg.getText();
    tagNameMap.set(className, tagName);
  });

  return tagNameMap;
}

function extractFromSourceFile(
  sourceFile: SourceFile,
  project: Project,
  result: ComponentExtractionResult,
): RawComponentDefinition[] {
  const components: RawComponentDefinition[] = [];
  const tagNameMap = buildTagNameMap(sourceFile);

  for (const { declaration: classDecl, name: className } of collectWebComponentClasses(sourceFile)) {
    if (Node.isClassExpression(classDecl)) {
      const tagName = tagNameMap.get(className);
      if (!tagName) continue;
      const syntax = readWebComponentSyntax(classDecl, sourceFile.getFilePath());
      result.extractionDiagnostics!.modules.push(...syntax.diagnostics);
      Object.assign(result.extractionDiagnostics!.limits, syntax.limits);
      result.extractionDiagnostics!.used.wcDeclarations =
        (result.extractionDiagnostics!.used.wcDeclarations ?? 0) + syntax.used.wcDeclarations;
      components.push({
        name: className,
        source: sourceFile.getFilePath(),
        sourcePath: sourceFile.getFilePath(),
        framework: 'web-component',
        props: syntax.props,
        slots: syntax.slots,
        sourceCandidates: syntax.sourceCandidates,
        factSchemaVersion: SOURCE_FACT_SCHEMA_VERSION,
      });
      continue;
    }
    const siblingDefinedTagName = getElementTagNameFromSiblingDefine(classDecl, project);

    // Prefer tag name from customElements.define() converted to PascalCase; fall back to class name
    const decoratorTagName = getElementTagNameFromDecorator(classDecl);
    const jsDocTagName = getElementTagNameFromJsDoc(classDecl);
    const fastDefinitionTagName = getElementTagNameFromFastDefinition(classDecl, project);
    const tagName =
      tagNameMap.get(className) ??
      siblingDefinedTagName ??
      decoratorTagName ??
      jsDocTagName ??
      fastDefinitionTagName ??
      undefined;
    if (!tagName) continue;
    const name = chooseComponentName(classDecl, className, tagName);

    const syntax = readWebComponentSyntax(classDecl, sourceFile.getFilePath());
    result.extractionDiagnostics!.modules.push(...syntax.diagnostics);
    Object.assign(result.extractionDiagnostics!.limits, syntax.limits);
    result.extractionDiagnostics!.used.wcDeclarations =
      (result.extractionDiagnostics!.used.wcDeclarations ?? 0) + syntax.used.wcDeclarations;
    const props = syntax.props;
    const slots = mergeSlotLists(syntax.slots, extractFastTemplateSlots(classDecl, project));

    components.push({
      name,
      source: sourceFile.getFilePath(),
      sourcePath: sourceFile.getFilePath(),
      framework: 'web-component',
      props,
      slots,
      sourceCandidates: syntax.sourceCandidates,
      factSchemaVersion: SOURCE_FACT_SCHEMA_VERSION,
    });
  }

  return components;
}

export async function extractWebComponentDefinitions(
  filePaths: string[],
  onProgress?: (progress: ExtractorProgress) => void,
  options: ExtractorOptions = {},
): Promise<ComponentExtractionResult> {
  const compiler = createWebComponentCompilerContexts(filePaths, options);
  const result: ComponentExtractionResult = {
    components: [],
    warnings: [],
    extractionDiagnostics: compiler.diagnostics,
  };
  let filesProcessed = 0;
  for (const context of compiler.contexts)
    for (const filePath of context.componentFiles) {
      if (options.signal?.aborted) {
        result.warnings.push('Web-component extraction aborted');
        break;
      }
      const sourceFile = context.project.getSourceFile(filePath);
      if (!sourceFile) {
        result.warnings.push(`Source unavailable: ${filePath}`);
        continue;
      }
      try {
        result.components.push(...extractFromSourceFile(sourceFile, context.project, result));
      } catch (error) {
        result.warnings.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      filesProcessed += 1;
      onProgress?.({ filesProcessed, componentsFound: result.components.length });
    }
  result.components.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

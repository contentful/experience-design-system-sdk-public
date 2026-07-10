import { basename, dirname, join, resolve } from 'node:path';
import { Project, Node, SyntaxKind, type SourceFile, type ClassDeclaration } from 'ts-morph';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
} from '../types.js';

function kebabToPascal(input: string): string {
  return input
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function normalizeComponentName(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function camelToKebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function kebabToCamel(input: string): string {
  return input.replace(/-([a-z0-9])/gi, (_, char: string) => char.toUpperCase());
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
        const importDecl = declarationNode.getImportDeclaration();
        const resolvedImportPath = resolveImportSourcePath(
          sourceFile.getFilePath(),
          importDecl.getModuleSpecifierValue(),
        );
        if (!resolvedImportPath) continue;

        const importedFile = loadSourceFile(project, resolvedImportPath);
        if (!importedFile) continue;

        const importedName = declarationNode.getNameNode().getText();
        const importedDeclaration = importedFile.getVariableDeclaration(importedName);
        if (!importedDeclaration) continue;

        const resolved = resolveStaticStringExpression(importedDeclaration.getInitializer(), importedFile, project);
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
        const importDecl = declarationNode.getImportDeclaration();
        const resolvedImportPath = resolveImportSourcePath(
          sourceFile.getFilePath(),
          importDecl.getModuleSpecifierValue(),
        );
        if (!resolvedImportPath) continue;

        const importedFile = loadSourceFile(project, resolvedImportPath);
        if (!importedFile) continue;

        const importedName = declarationNode.getNameNode().getText();
        variableDeclaration = importedFile.getVariableDeclaration(importedName);
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

function extractJsDocSlots(classDecl: ClassDeclaration): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];

  for (const jsDoc of classDecl.getJsDocs()) {
    for (const tag of jsDoc.getTags()) {
      if (tag.getTagName() !== 'slot') continue;

      const comment = tag.getCommentText()?.trim();
      if (!comment) continue;

      let name = 'default';
      let description = comment;

      if (comment.startsWith('-')) {
        description = comment.slice(1).trim();
      } else {
        const match = comment.match(/^(\S+)\s*-\s*(.*)$/s);
        if (match) {
          name = match[1];
          description = match[2].trim();
        }
      }

      slots.push({
        name,
        isDefault: name === 'default',
        ...(description && { description }),
      });
    }
  }

  return mergeSlotLists(slots);
}

function extractObservedAttributes(classDecl: ClassDeclaration): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];

  const getter = classDecl.getGetAccessor('observedAttributes');
  if (!getter || !getter.isStatic()) return props;

  const body = getter.getBody();
  if (!body) return props;

  // Find the return statement containing an array literal
  body.forEachDescendant((node) => {
    if (!Node.isReturnStatement(node)) return;

    const expression = node.getExpression();
    if (!expression || !Node.isArrayLiteralExpression(expression)) return;

    for (const element of expression.getElements()) {
      if (Node.isStringLiteral(element)) {
        const attrName = element.getLiteralValue();
        props.push({
          name: attrName,
          type: 'string',
          required: false,
        });
      }
    }
  });

  return props;
}

function hasInternalJsDocTag(member: { getJsDocs(): import('ts-morph').JSDoc[] }): boolean {
  return member.getJsDocs().some((doc) => doc.getTags().some((tag) => tag.getTagName() === 'internal'));
}

const NON_PUBLIC_LIT_DECORATORS = new Set(['consume', 'provide', 'query', 'queryAsync', 'state']);
const INTERNAL_RUNTIME_FIELD_NAMES = new Set(['dir', 'initialReflectedProperties', 'lang']);

function isNonPublicLitMember(member: { getDecorators(): import('ts-morph').Decorator[] }): boolean {
  return member.getDecorators().some((decorator) => NON_PUBLIC_LIT_DECORATORS.has(decorator.getName()));
}

function hasShoelaceRuntimeBookkeepingField(classDecl: ClassDeclaration): boolean {
  return classDecl.getProperties().some((property) => property.getName() === 'initialReflectedProperties');
}

function isInternalRuntimeField(name: string, applyRuntimeFieldDenylist: boolean): boolean {
  return applyRuntimeFieldDenylist && INTERNAL_RUNTIME_FIELD_NAMES.has(name);
}

function getExplicitLitPropertyAttributeName(property: import('ts-morph').PropertyDeclaration): string | null {
  const decorator = property.getDecorators().find((candidate) => candidate.getName() === 'property');
  const firstArg = decorator?.getArguments()[0];
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) {
    return null;
  }

  const attributeProp = firstArg.getProperty('attribute');
  if (!attributeProp || !Node.isPropertyAssignment(attributeProp)) {
    return null;
  }

  const initializer = attributeProp.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) {
    return null;
  }

  return initializer.getLiteralValue();
}

function extractClassProperties(classDecl: ClassDeclaration, applyRuntimeFieldDenylist = false): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];

  for (const property of classDecl.getProperties()) {
    if (property.isStatic()) continue;
    if (hasInternalJsDocTag(property)) continue;
    if (isNonPublicLitMember(property)) continue;

    const name = property.getName();
    if (name.startsWith('#') || isInternalRuntimeField(name, applyRuntimeFieldDenylist)) continue;
    const scope = property.getScope();
    if (scope === 'private' || scope === 'protected') continue;

    const initializer = property.getInitializer();
    const hasDecorators = property.getDecorators().length > 0;

    // Skip undecorated arrow-function properties (internal event handlers / callbacks)
    if (!hasDecorators && initializer && Node.isArrowFunction(initializer)) {
      continue;
    }

    // Skip properties initialized with this.attachInternals() (ElementInternals)
    if (
      initializer &&
      Node.isCallExpression(initializer) &&
      initializer.getExpression().getText() === 'this.attachInternals'
    ) {
      continue;
    }

    const typeNode = property.getTypeNode();
    const type = typeNode ? typeNode.getText() : 'any';
    const publicName = name.startsWith('_') && hasDecorators ? getExplicitLitPropertyAttributeName(property) : null;

    let defaultValue: string | undefined;

    if (initializer) {
      if (Node.isStringLiteral(initializer)) {
        defaultValue = initializer.getLiteralValue();
      } else {
        defaultValue = initializer.getText();
      }
    }

    props.push({
      name: publicName ? kebabToCamel(publicName) : name,
      type,
      required: false,
      ...(defaultValue !== undefined && { defaultValue }),
      sourceStartLine: property.getStartLineNumber(),
      sourceEndLine: property.getEndLineNumber(),
    });
  }

  return props;
}

function extractAccessorProperties(
  classDecl: ClassDeclaration,
  applyRuntimeFieldDenylist = false,
): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];
  const accessors = new Map<
    string,
    {
      getter?: ReturnType<ClassDeclaration['getGetAccessor']>;
      setter?: ReturnType<ClassDeclaration['getSetAccessor']>;
    }
  >();

  for (const getter of classDecl.getGetAccessors()) {
    if (getter.isStatic()) continue;
    if (hasInternalJsDocTag(getter)) continue;
    if (isNonPublicLitMember(getter)) continue;

    const name = getter.getName();
    if (
      name === 'observedAttributes' ||
      name === 'template' ||
      name.startsWith('#') ||
      isInternalRuntimeField(name, applyRuntimeFieldDenylist)
    )
      continue;

    const scope = getter.getScope();
    if (scope === 'private' || scope === 'protected') continue;

    const entry = accessors.get(name) ?? {};
    entry.getter = getter;
    accessors.set(name, entry);
  }

  for (const setter of classDecl.getSetAccessors()) {
    if (setter.isStatic()) continue;
    if (hasInternalJsDocTag(setter)) continue;
    if (isNonPublicLitMember(setter)) continue;

    const name = setter.getName();
    if (
      name === 'observedAttributes' ||
      name === 'template' ||
      name.startsWith('#') ||
      isInternalRuntimeField(name, applyRuntimeFieldDenylist)
    )
      continue;

    const scope = setter.getScope();
    if (scope === 'private' || scope === 'protected') continue;

    const entry = accessors.get(name) ?? {};
    entry.setter = setter;
    accessors.set(name, entry);
  }

  for (const [name, { getter, setter }] of accessors) {
    const hasPropertyDecorator =
      getter?.getDecorators().some((decorator) => decorator.getName() === 'property') ||
      setter?.getDecorators().some((decorator) => decorator.getName() === 'property');
    if (!hasPropertyDecorator && !(getter && setter)) continue;

    const type =
      getter?.getReturnTypeNode()?.getText() ?? setter?.getParameters()[0]?.getTypeNode()?.getText() ?? 'any';

    const accessorNode = getter ?? setter;
    props.push({
      name,
      type,
      required: false,
      ...(accessorNode
        ? {
            sourceStartLine: accessorNode.getStartLineNumber(),
            sourceEndLine: accessorNode.getEndLineNumber(),
          }
        : {}),
    });
  }

  return props;
}

function extractJsDocAttributeProps(classDecl: ClassDeclaration): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];

  for (const doc of classDecl.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() !== 'attribute') continue;

      const tagComment = tag.getCommentText();
      const normalizedComment = Array.isArray(tagComment) ? tagComment.join(' ') : tagComment;
      const match = normalizedComment?.match(/(?:\{([^}]+)\}\s+)?([^\s]+)(?:\s*-\s*([\s\S]*))?/);
      if (!match) continue;

      const [, type, name, description] = match;
      if (!name || name.startsWith('#')) continue;

      props.push({
        name,
        type: type?.trim() || 'any',
        required: false,
        ...(description ? { description: description.replace(/\s+/g, ' ').trim() } : {}),
      });
    }
  }

  return props;
}

function mergePropLists(...propLists: RawPropDefinition[][]): RawPropDefinition[] {
  const merged = new Map<string, RawPropDefinition>();

  for (const propList of propLists) {
    for (const prop of propList) {
      merged.set(prop.name, prop);
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeProps(observed: RawPropDefinition[], classProps: RawPropDefinition[]): RawPropDefinition[] {
  return mergePropLists(observed, classProps);
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

function extractTemplateContent(classDecl: ClassDeclaration, project: Project): string {
  const templates: string[] = [];

  // Strategy 1: innerHTML assignment in methods (connectedCallback, etc.)
  classDecl.forEachDescendant((node) => {
    if (!Node.isBinaryExpression(node)) return;

    const leftText = node.getLeft().getText();
    if (!leftText.includes('.innerHTML')) return;

    const right = node.getRight();
    if (Node.isTemplateExpression(right) || Node.isNoSubstitutionTemplateLiteral(right)) {
      templates.push(right.getText().slice(1, -1)); // strip surrounding backticks
    }
  });

  // Strategy 2: Lit render() method with html tagged template
  const renderMethod = classDecl.getMethod('render');
  if (renderMethod && !renderMethod.isStatic()) {
    templates.push(...collectHtmlTaggedTemplatesWithHelpers(renderMethod, project));
  }

  // Strategy 3: Polymer static get template() with html tagged template
  const templateGetter = classDecl.getGetAccessor('template');
  if (templateGetter?.isStatic()) {
    templateGetter.forEachDescendant((node) => {
      if (Node.isTaggedTemplateExpression(node)) {
        const tag = node.getTag();
        if (tag.getText() === 'html') {
          const template = node.getTemplate();
          if (Node.isNoSubstitutionTemplateLiteral(template)) {
            templates.push(template.getText().slice(1, -1));
          } else if (Node.isTemplateExpression(template)) {
            templates.push(template.getText().slice(1, -1));
          }
        }
      }
    });
  }

  return templates.join('\n');
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

function getImportedBaseClass(
  classDecl: ClassDeclaration,
  project: Project,
  visitedFiles: Set<string>,
): ClassDeclaration | null {
  const extendsClause = classDecl
    .getHeritageClauses()
    .find((clause) => clause.getToken() === SyntaxKind.ExtendsKeyword);
  const typeNode = extendsClause?.getTypeNodes()[0];
  if (!typeNode) return null;

  const expression = typeNode.getExpression();
  if (!Node.isIdentifier(expression)) return null;
  const baseName = expression.getText();

  const importDecl = classDecl
    .getSourceFile()
    .getImportDeclarations()
    .find(
      (decl) =>
        decl.getNamedImports().some((namedImport) => namedImport.getName() === baseName) ||
        decl.getDefaultImport()?.getText() === baseName,
    );
  if (!importDecl) return null;

  const resolvedImportPath = resolveImportSourcePath(
    classDecl.getSourceFile().getFilePath(),
    importDecl.getModuleSpecifierValue(),
  );
  if (!resolvedImportPath || visitedFiles.has(resolvedImportPath)) {
    return null;
  }
  visitedFiles.add(resolvedImportPath);

  let sourceFile = project.getSourceFile(resolvedImportPath);
  if (!sourceFile) {
    try {
      sourceFile = project.addSourceFileAtPath(resolvedImportPath);
    } catch {
      return null;
    }
  }

  const directClass = sourceFile.getClass(baseName);
  if (directClass) {
    return directClass;
  }

  for (const exportDecl of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;

    const reexportPath = resolveImportSourcePath(sourceFile.getFilePath(), moduleSpecifier);
    if (!reexportPath || visitedFiles.has(reexportPath)) continue;
    visitedFiles.add(reexportPath);

    let reexportFile = project.getSourceFile(reexportPath);
    if (!reexportFile) {
      try {
        reexportFile = project.addSourceFileAtPath(reexportPath);
      } catch {
        continue;
      }
    }

    const reexportedClass = reexportFile.getClass(baseName);
    if (reexportedClass) {
      return reexportedClass;
    }
  }

  return null;
}

function extractInheritedClassProperties(
  classDecl: ClassDeclaration,
  project: Project,
  visitedFiles: Set<string> = new Set(),
  applyRuntimeFieldDenylist = false,
): RawPropDefinition[] {
  const baseClass = getImportedBaseClass(classDecl, project, visitedFiles);
  if (!baseClass) {
    return [];
  }

  const nextApplyRuntimeFieldDenylist = applyRuntimeFieldDenylist || hasShoelaceRuntimeBookkeepingField(baseClass);
  return mergePropLists(
    extractInheritedClassProperties(baseClass, project, visitedFiles, nextApplyRuntimeFieldDenylist),
    extractJsDocAttributeProps(baseClass),
    extractAccessorProperties(baseClass, nextApplyRuntimeFieldDenylist),
    extractClassProperties(baseClass, nextApplyRuntimeFieldDenylist),
  );
}

function extractInheritedSlots(
  classDecl: ClassDeclaration,
  project: Project,
  visitedFiles: Set<string> = new Set(),
): RawSlotDefinition[] {
  const baseClass = getImportedBaseClass(classDecl, project, visitedFiles);
  if (!baseClass) {
    return [];
  }

  return mergeSlotLists(extractInheritedSlots(baseClass, project, visitedFiles), extractJsDocSlots(baseClass));
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

function extractFromSourceFile(sourceFile: SourceFile, project: Project): RawComponentDefinition[] {
  const components: RawComponentDefinition[] = [];
  const tagNameMap = buildTagNameMap(sourceFile);

  for (const classDecl of sourceFile.getClasses()) {
    const siblingDefinedTagName = getElementTagNameFromSiblingDefine(classDecl, project);
    const className = classDecl.getName();
    if (!className) continue;

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

    const observedAttrs = extractObservedAttributes(classDecl);
    const inheritedProps = extractInheritedClassProperties(classDecl, project);
    const classProps = mergePropLists(
      extractJsDocAttributeProps(classDecl),
      extractAccessorProperties(classDecl),
      extractClassProperties(classDecl),
    );
    const props = mergeProps(observedAttrs, mergePropLists(inheritedProps, classProps));

    const templateContent = extractTemplateContent(classDecl, project);
    const slots = mergeSlotLists(
      extractInheritedSlots(classDecl, project),
      extractJsDocSlots(classDecl),
      extractSlotsFromTemplate(templateContent),
      extractFastTemplateSlots(classDecl, project),
    );

    components.push({
      name,
      source: sourceFile.getFilePath(),
      sourcePath: sourceFile.getFilePath(),
      framework: 'web-component',
      props,
      slots,
    });
  }

  return components;
}

export async function extractWebComponentDefinitions(filePaths: string[]): Promise<ComponentExtractionResult> {
  const tsFiles = filePaths.filter((f) => /\.[jt]s$/.test(f) && !f.endsWith('.d.ts'));
  if (tsFiles.length === 0) {
    return { components: [], warnings: [] };
  }

  const project = new Project({
    compilerOptions: {
      target: 99, // ScriptTarget.ESNext
      module: 99, // ModuleKind.ESNext
      moduleResolution: 100, // ModuleResolutionKind.Bundler
      skipLibCheck: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  for (const filePath of tsFiles) {
    project.addSourceFileAtPath(filePath);
  }

  const warnings: string[] = [];
  const components: RawComponentDefinition[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    try {
      const extracted = extractFromSourceFile(sourceFile, project);
      components.push(...extracted);
    } catch (e) {
      warnings.push(
        `Failed to extract from ${sourceFile.getFilePath()}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

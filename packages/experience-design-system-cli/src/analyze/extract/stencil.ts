import { Project, Node, type SourceFile, type ClassDeclaration } from 'ts-morph';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
} from '../../types.js';

function isStencilFile(sourceFile: SourceFile): boolean {
  return sourceFile.getImportDeclarations().some((imp) => imp.getModuleSpecifierValue() === '@stencil/core');
}

function kebabToPascal(input: string): string {
  return input
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function getComponentTag(classDecl: ClassDeclaration): string | undefined {
  for (const decorator of classDecl.getDecorators()) {
    if (decorator.getName() !== 'Component') continue;

    const args = decorator.getArguments();
    if (args.length === 0) continue;

    const arg = args[0];
    if (!Node.isObjectLiteralExpression(arg)) continue;

    const tagProp = arg.getProperty('tag');
    if (!tagProp || !Node.isPropertyAssignment(tagProp)) continue;

    const initializer = tagProp.getInitializer();
    if (!initializer || !Node.isStringLiteral(initializer)) continue;

    return initializer.getLiteralValue();
  }

  return undefined;
}

function hasDecorator(node: Node, decoratorName: string): boolean {
  if (!Node.isPropertyDeclaration(node)) return false;
  return node.getDecorators().some((d) => d.getName() === decoratorName);
}

function extractAllowedValues(typeText: string): string[] | undefined {
  // Match inline string literal unions: 'a' | 'b' | 'c'
  const literalPattern = /^'[^']*'(?:\s*\|\s*'[^']*')+$/;
  if (!literalPattern.test(typeText.trim())) return undefined;

  const values = typeText
    .split('|')
    .map((v) => v.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
    .sort();

  return values.length >= 2 ? values : undefined;
}

function extractProps(classDecl: ClassDeclaration): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];

  for (const property of classDecl.getProperties()) {
    if (!hasDecorator(property, 'Prop')) continue;

    const name = property.getName();
    const typeNode = property.getTypeNode();
    const typeText = typeNode ? typeNode.getText() : 'unknown';

    const hasQuestionToken = property.hasQuestionToken();
    const hasExclamation = property.hasExclamationToken();
    const initializer = property.getInitializer();

    let defaultValue: string | undefined;
    if (initializer) {
      if (Node.isStringLiteral(initializer)) {
        defaultValue = initializer.getLiteralValue();
      } else {
        defaultValue = initializer.getText();
      }
    }

    const isRequired = hasExclamation || (!hasQuestionToken && !initializer);

    // JSDoc description
    const jsDocs = property.getJsDocs();
    let description: string | undefined;
    let isDeprecated = false;

    if (jsDocs.length > 0) {
      const jsDoc = jsDocs[0];
      description = jsDoc.getDescription().trim() || undefined;

      for (const tag of jsDoc.getTags()) {
        if (tag.getTagName() === 'deprecated') {
          isDeprecated = true;
          // The deprecated tag may carry a message (e.g. "@deprecated Use size instead.")
          const tagComment = tag.getCommentText()?.trim();
          if (tagComment && !description) {
            description = tagComment;
          }
        }
      }
    }

    if (isDeprecated && description) {
      description = `[DEPRECATED] ${description}`;
    } else if (isDeprecated) {
      description = '[DEPRECATED]';
    }

    const allowedValues = extractAllowedValues(typeText);

    props.push({
      name,
      type: typeText,
      required: isRequired,
      ...(defaultValue !== undefined && { defaultValue }),
      ...(description && { description }),
      ...(allowedValues && { allowedValues }),
    });
  }

  return props.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSlotName(name: string | undefined): RawSlotDefinition {
  const normalizedName = name && name.length > 0 ? name : 'default';
  return {
    name: normalizedName,
    isDefault: normalizedName === 'default',
  };
}

function extractSlots(classDecl: ClassDeclaration, warnings: string[], componentName: string): RawSlotDefinition[] {
  const slots = new Map<string, RawSlotDefinition>();
  const upsertSlot = (slot: RawSlotDefinition) => {
    const existing = slots.get(slot.name);
    if (!existing) {
      slots.set(slot.name, slot);
      return;
    }

    slots.set(slot.name, {
      ...existing,
      ...slot,
      description: existing.description ?? slot.description,
    });
  };

  const jsDocs = classDecl.getJsDocs();

  for (const jsDoc of jsDocs) {
    for (const tag of jsDoc.getTags()) {
      if (tag.getTagName() !== 'slot') continue;

      const comment = tag.getCommentText()?.trim();
      if (!comment) continue;

      if (comment.startsWith('{')) {
        try {
          const parsed = JSON.parse(comment) as {
            name?: string;
            description?: string;
            isDeprecated?: boolean;
          };
          const slot = normalizeSlotName(parsed.name);

          let description = parsed.description || undefined;
          if (parsed.isDeprecated && description) {
            description = `[DEPRECATED] ${description}`;
          } else if (parsed.isDeprecated) {
            description = '[DEPRECATED]';
          }

          upsertSlot({
            ...slot,
            ...(description && { description }),
          });
          continue;
        } catch {
          warnings.push(`Failed to parse @slot JSDoc in ${componentName}: invalid JSON "${comment}"`);
          continue;
        }
      }

      const match = comment.match(/^(?:(\S+)\s*-\s*)?(.*)$/s);
      if (!match) continue;

      const [, rawName, rawDescription] = match;
      const slot = normalizeSlotName(rawName);
      const description = rawDescription.trim() || undefined;

      upsertSlot({
        ...slot,
        ...(description && { description }),
      });
    }
  }

  for (const method of classDecl.getMethods()) {
    method.forEachDescendant((node) => {
      if (!Node.isJsxSelfClosingElement(node) && !Node.isJsxElement(node)) return;

      const openingElement = Node.isJsxElement(node) ? node.getOpeningElement() : node;
      const tagName = openingElement.getTagNameNode().getText();
      const slotAttribute = openingElement
        .getAttributes()
        .find((attribute) => Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === 'slot');

      if (tagName === 'slot') {
        const nameAttribute = openingElement
          .getAttributes()
          .find((attribute) => Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === 'name');

        const initializer = Node.isJsxAttribute(nameAttribute) ? nameAttribute.getInitializer() : undefined;
        const name =
          initializer && Node.isStringLiteral(initializer)
            ? initializer.getLiteralValue()
            : initializer && Node.isJsxExpression(initializer)
              ? (initializer.getExpression()?.getText() ?? '')
              : '';

        upsertSlot({
          ...normalizeSlotName(name),
        });
        return;
      }

      if (!Node.isJsxAttribute(slotAttribute)) return;

      const initializer = slotAttribute.getInitializer();
      if (!initializer || !Node.isStringLiteral(initializer)) return;

      const name = initializer.getLiteralValue();
      if (!name) return;

      upsertSlot({
        name,
        isDefault: false,
      });
    });
  }

  return [...slots.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function detectEvents(classDecl: ClassDeclaration): string[] {
  const eventNames: string[] = [];

  for (const property of classDecl.getProperties()) {
    if (!hasDecorator(property, 'Event')) continue;
    eventNames.push(property.getName());
  }

  return eventNames.sort();
}

function extractFromSourceFile(sourceFile: SourceFile, warnings: string[]): RawComponentDefinition[] {
  const components: RawComponentDefinition[] = [];

  for (const classDecl of sourceFile.getClasses()) {
    const tag = getComponentTag(classDecl);
    if (!tag) continue;

    const name = kebabToPascal(tag);
    const props = extractProps(classDecl);
    const slots = extractSlots(classDecl, warnings, name);

    const eventNames = detectEvents(classDecl);
    if (eventNames.length > 0) {
      warnings.push(`Component ${name} has ${eventNames.length} events not captured: ${eventNames.join(', ')}`);
    }

    components.push({
      name,
      source: sourceFile.getFilePath(),
      framework: 'stencil',
      props,
      slots,
    });
  }

  return components;
}

function detectFunctionalComponents(sourceFile: SourceFile, warnings: string[]): void {
  for (const [exportName, declarations] of sourceFile.getExportedDeclarations()) {
    for (const decl of declarations) {
      if (!Node.isVariableDeclaration(decl)) continue;

      const typeNode = decl.getTypeNode();
      if (!typeNode) continue;

      const typeText = typeNode.getText();
      if (!typeText.startsWith('FunctionalComponent')) continue;

      warnings.push(
        `Stencil FunctionalComponent detected but not extracted: ${exportName} in ${sourceFile.getFilePath()}`,
      );
    }
  }
}

export async function extractStencilComponents(filePaths: string[]): Promise<ComponentExtractionResult> {
  const tsxFiles = filePaths.filter((f) => /\.[jt]sx$/.test(f));
  if (tsxFiles.length === 0) {
    return { components: [], warnings: [] };
  }

  const project = new Project({
    compilerOptions: {
      jsx: 1, // JsxEmit.Preserve
      target: 99, // ScriptTarget.ESNext
      module: 99, // ModuleKind.ESNext
      moduleResolution: 100, // ModuleResolutionKind.Bundler
      skipLibCheck: true,
      allowJs: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  for (const filePath of tsxFiles) {
    project.addSourceFileAtPath(filePath);
  }

  const warnings: string[] = [];
  const components: RawComponentDefinition[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    try {
      if (!isStencilFile(sourceFile)) continue;
      const extracted = extractFromSourceFile(sourceFile, warnings);
      components.push(...extracted);
      detectFunctionalComponents(sourceFile, warnings);
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

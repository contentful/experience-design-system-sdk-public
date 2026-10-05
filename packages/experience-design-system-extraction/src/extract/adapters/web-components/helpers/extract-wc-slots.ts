import { Node, type ClassDeclaration, type Project } from 'ts-morph';
import type { RawSlotDefinition } from '../../../model/component.js';
import { loadSourceFile, resolveImportSourcePath } from './resolve-wc-import.js';

export function extractSlotsFromTemplate(templateContent: string): RawSlotDefinition[] {
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

export function mergeSlotLists(...slotLists: RawSlotDefinition[][]): RawSlotDefinition[] {
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

export function extractJsDocSlots(classDecl: ClassDeclaration): RawSlotDefinition[] {
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
          name = match[1]!;
          description = match[2]!.trim();
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

export function extractTemplateContent(classDecl: ClassDeclaration, project: Project): string {
  const templates: string[] = [];

  classDecl.forEachDescendant((node) => {
    if (!Node.isBinaryExpression(node)) return;

    const leftText = node.getLeft().getText();
    if (!leftText.includes('.innerHTML')) return;

    const right = node.getRight();
    if (Node.isTemplateExpression(right) || Node.isNoSubstitutionTemplateLiteral(right)) {
      templates.push(right.getText().slice(1, -1));
    }
  });

  const renderMethod = classDecl.getMethod('render');
  if (renderMethod && !renderMethod.isStatic()) {
    templates.push(...collectHtmlTaggedTemplatesWithHelpers(renderMethod, project));
  }

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

export function extractFastTemplateSlots(classDecl: ClassDeclaration, project: Project): RawSlotDefinition[] {
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

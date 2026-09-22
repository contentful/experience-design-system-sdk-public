import { basename } from 'node:path';
import { Project, Node } from 'ts-morph';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
} from '../types.js';
import {
  createSortedExtractionResult,
  runFileExtractionWorkers,
  extractConcurrency,
} from './file-extraction-workers.js';
import { resolveTypeProperty } from './resolve-type-property.js';
import { getSourceLineMetadata } from './source-line-metadata.js';

function extractAllowedValues(typeText: string): string[] | undefined {
  // Check if the type is a union of string literals like 'a' | 'b' | 'c'
  const parts = typeText.split('|').map((p) => p.trim());
  const literals = parts.filter((p) => /^['"]/.test(p)).map((p) => p.replace(/^['"]|['"]$/g, ''));

  return literals.length >= 2 ? literals.sort() : undefined;
}

function usesAstroProps(initializer: Node | undefined): boolean {
  if (!initializer) return false;
  if (initializer.getText() === 'Astro.props') return true;

  let found = false;
  initializer.forEachDescendant((node) => {
    if (found) return false;
    if (Node.isPropertyAccessExpression(node) && node.getText() === 'Astro.props') {
      found = true;
      return false;
    }
    return undefined;
  });

  return found;
}

function extractBindingPropName(element: import('ts-morph').BindingElement): string | null {
  if (element.getText().startsWith('...')) return null;
  return element.getPropertyNameNode()?.getText() ?? element.getNameNode().getText();
}

function createAstroFrontmatterProject(): Project {
  return new Project({
    compilerOptions: {
      strict: false,
      target: 99,
      module: 99,
      allowJs: true,
    },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
}

function forEachAstroPropsBinding(
  frontmatter: string,
  visit: (element: import('ts-morph').BindingElement) => void,
): void {
  const sf = createAstroFrontmatterProject().createSourceFile('__frontmatter__.ts', frontmatter);

  sf.forEachDescendant((node) => {
    if (!Node.isVariableDeclaration(node)) return;

    const initializer = node.getInitializer();
    if (!initializer || !usesAstroProps(initializer)) return;

    const nameNode = node.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) return;

    for (const element of nameNode.getElements()) visit(element);
  });
}

function extractFallbackPropsFromFrontmatter(frontmatter: string): RawPropDefinition[] {
  const props = new Map<string, RawPropDefinition>();

  forEachAstroPropsBinding(frontmatter, (element) => {
    const propName = extractBindingPropName(element);
    if (!propName) return;

    props.set(propName, {
      name: propName,
      type: 'any',
      required: !element.getInitializer(),
    });
  });

  return [...props.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeProps(...propGroups: RawPropDefinition[][]): RawPropDefinition[] {
  const merged = new Map<string, RawPropDefinition>();

  for (const props of propGroups) {
    for (const prop of props) {
      const existing = merged.get(prop.name);
      merged.set(
        prop.name,
        existing
          ? {
              ...existing,
              ...prop,
              required: existing.required && prop.required,
            }
          : prop,
      );
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function extractPropsFromFrontmatter(frontmatter: string): RawPropDefinition[] {
  const sf = createAstroFrontmatterProject().createSourceFile('__frontmatter__.ts', frontmatter);
  const props: RawPropDefinition[] = [];

  // Find `interface Props` or `type Props = ...`
  const propsInterface = sf.getInterface('Props');
  const propsTypeAlias = sf.getTypeAlias('Props');

  if (propsInterface) {
    for (const member of propsInterface.getProperties()) {
      const name = member.getName();
      const typeText = member.getTypeNode()?.getText() ?? 'any';
      const required = !member.hasQuestionToken();
      const allowedValues = extractAllowedValues(typeText);

      props.push({
        name,
        type: typeText,
        required,
        ...(allowedValues && { allowedValues }),
        sourceStartLine: member.getStartLineNumber(),
        sourceEndLine: member.getEndLineNumber(),
      });
    }
  } else if (propsTypeAlias) {
    const type = propsTypeAlias.getType();
    for (const property of type.getProperties()) {
      const resolved = resolveTypeProperty(property);
      if (!resolved) continue;

      const { name, declaration: decl, typeText, required } = resolved;
      const allowedValues = extractAllowedValues(typeText);

      props.push({
        name,
        type: typeText,
        required,
        ...(allowedValues && { allowedValues }),
        ...getSourceLineMetadata(decl),
      });
    }
  }

  return props.sort((a, b) => a.name.localeCompare(b.name));
}

function extractDefaultsFromFrontmatter(frontmatter: string): Map<string, string> {
  const defaults = new Map<string, string>();
  forEachAstroPropsBinding(frontmatter, (element) => {
    const propName = extractBindingPropName(element);
    if (!propName) return;
    const elementInitializer = element.getInitializer();
    if (!elementInitializer) return;

    const value = elementInitializer.getText().replace(/^['"]|['"]$/g, '');
    defaults.set(propName, value);
  });

  return defaults;
}

function extractSlotsFromTemplate(template: string): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];
  const seen = new Set<string>();

  const slotRegex = /<slot(?:\s+name=["']([^"']+)["'])?\s*\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = slotRegex.exec(template)) !== null) {
    const slotName = match[1] ?? 'default';
    if (!seen.has(slotName)) {
      seen.add(slotName);
      slots.push({ name: slotName, isDefault: slotName === 'default' });
    }
  }

  return slots;
}

function extractSlotsFromFrontmatter(frontmatter: string): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];
  const seen = new Set<string>();
  const slotRenderRegex = /Astro\.slots\.render\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = slotRenderRegex.exec(frontmatter)) !== null) {
    const slotName = match[1];
    if (!seen.has(slotName)) {
      seen.add(slotName);
      slots.push({ name: slotName, isDefault: slotName === 'default' });
    }
  }

  return slots;
}

function mergeSlots(...slotGroups: RawSlotDefinition[][]): RawSlotDefinition[] {
  const merged: RawSlotDefinition[] = [];
  const seen = new Set<string>();

  for (const slots of slotGroups) {
    for (const slot of slots) {
      if (seen.has(slot.name)) continue;
      seen.add(slot.name);
      merged.push(slot);
    }
  }

  return merged;
}

function extractFromAstroFile(filePath: string, source: string): RawComponentDefinition {
  const name = basename(filePath, '.astro');

  // Split on `---` fences: frontmatter is between first and second `---`
  // If there is no `---`, the entire file is a template-only component
  const fenceIndex = source.startsWith('---') ? 0 : -1;
  let frontmatter = '';
  let template = source;

  if (fenceIndex !== -1) {
    const endFenceIndex = source.indexOf('---', fenceIndex + 3);
    if (endFenceIndex !== -1) {
      frontmatter = source.slice(fenceIndex + 3, endFenceIndex);
      template = source.slice(endFenceIndex + 3);
    }
  }

  const props = frontmatter
    ? mergeProps(extractFallbackPropsFromFrontmatter(frontmatter), extractPropsFromFrontmatter(frontmatter))
    : [];
  const defaults = frontmatter ? extractDefaultsFromFrontmatter(frontmatter) : new Map<string, string>();

  const propsWithDefaults = props.map((p) => {
    const defaultValue = defaults.get(p.name);
    return defaultValue ? { ...p, defaultValue } : p;
  });

  const slots = mergeSlots(extractSlotsFromTemplate(template), extractSlotsFromFrontmatter(frontmatter));

  return {
    name,
    source: filePath,
    sourcePath: filePath,
    framework: 'astro',
    props: propsWithDefaults,
    slots,
  };
}

export async function extractAstroComponents(
  filePaths: string[],
  onProgress?: (p: { filesProcessed: number; componentsFound: number }) => void,
): Promise<ComponentExtractionResult> {
  const astroFiles = filePaths.filter((f) => f.endsWith('.astro'));
  const { items: components, warnings } = await runFileExtractionWorkers(
    astroFiles,
    extractConcurrency(),
    async (filePath, source) => ({
      item: extractFromAstroFile(filePath, source),
    }),
    (filePath, error) =>
      `Failed to extract from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    onProgress,
  );

  return createSortedExtractionResult(components, warnings);
}

import type { RawPropDefinition } from '../../types/component.js';
import { resolveTypeProperty } from '../shared/helpers/resolve-type-symbol.js';
import { getSourceLineMetadata } from '../shared/helpers/get-node-source-lines.js';
import {
  createAstroFrontmatterProject,
  collectAstroPropsBindings,
  extractBindingPropName,
} from './helpers/collect-astro-props-bindings.js';

function extractAllowedValues(typeText: string): string[] | undefined {
  const parts = typeText.split('|').map((p) => p.trim());
  const literals = parts.filter((p) => /^['"]/.test(p)).map((p) => p.replace(/^['"]|['"]$/g, ''));
  return literals.length >= 2 ? literals.sort() : undefined;
}

export function extractFallbackPropsFromFrontmatter(frontmatter: string): RawPropDefinition[] {
  const props = new Map<string, RawPropDefinition>();
  for (const element of collectAstroPropsBindings(frontmatter)) {
    const propName = extractBindingPropName(element);
    if (!propName) continue;
    props.set(propName, {
      name: propName,
      type: 'any',
      required: !element.getInitializer(),
    });
  }
  return [...props.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function extractPropsFromFrontmatter(frontmatter: string): RawPropDefinition[] {
  const sf = createAstroFrontmatterProject().createSourceFile('__frontmatter__.ts', frontmatter);
  const props: RawPropDefinition[] = [];

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

export function extractDefaultsFromFrontmatter(frontmatter: string): Map<string, string> {
  const defaults = new Map<string, string>();
  for (const element of collectAstroPropsBindings(frontmatter)) {
    const propName = extractBindingPropName(element);
    if (!propName) continue;
    const elementInitializer = element.getInitializer();
    if (!elementInitializer) continue;
    defaults.set(propName, elementInitializer.getText().replace(/^['"]|['"]$/g, ''));
  }
  return defaults;
}

export function mergeProps(...propGroups: RawPropDefinition[][]): RawPropDefinition[] {
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

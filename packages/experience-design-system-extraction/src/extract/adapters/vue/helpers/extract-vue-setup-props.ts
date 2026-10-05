import { Project, Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { resolveTypeProperty } from '../../support/resolution/type-property.js';
import { collectSetupImportedObjectRefs, mergeSetupObjectProps } from './extract-vue-setup-object-props.js';

function extractGenericSetupProps(typeText: string): RawPropDefinition[] {
  const project = new Project({
    compilerOptions: { strict: true, target: 99, module: 99 },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  const sf = project.createSourceFile('__props__.ts', `type __Props__ = ${typeText};`);
  const typeAlias = sf.getTypeAlias('__Props__');
  if (!typeAlias) return [];

  const props: RawPropDefinition[] = [];
  for (const property of typeAlias.getType().getProperties()) {
    const resolved = resolveTypeProperty(property);
    if (!resolved) continue;
    let { typeText: resolvedTypeText } = resolved;
    if (!resolved.required) {
      resolvedTypeText = resolvedTypeText.replace(/\s*\|\s*undefined$/, '').replace(/^undefined\s*\|\s*/, '');
    }
    props.push({ name: resolved.name, type: resolvedTypeText, required: resolved.required });
  }

  return props.sort((a, b) => a.name.localeCompare(b.name));
}

export async function extractVueSetupProps(
  filePath: string,
  scriptSetupContent: string,
): Promise<RawPropDefinition[] | null> {
  const project = new Project({
    compilerOptions: { strict: false, target: 99, module: 99, allowJs: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  const sf = project.createSourceFile('__setup__.ts', scriptSetupContent);

  let genericTypeText: string | null = null;
  sf.forEachDescendant((node) => {
    if (genericTypeText !== null) return;
    if (Node.isCallExpression(node) && node.getExpression().getText() === 'defineProps' && node.getTypeArguments().length > 0) {
      genericTypeText = node.getTypeArguments()[0].getText();
    }
  });

  if (genericTypeText !== null) return extractGenericSetupProps(genericTypeText);

  const importedObjectRefs = collectSetupImportedObjectRefs(sf, filePath);
  let objectProps: RawPropDefinition[] | null = null;
  const visitedImports = new Set<string>();
  for (const node of sf.getDescendants()) {
    if (objectProps !== null) break;
    if (Node.isCallExpression(node) && node.getExpression().getText() === 'defineProps' && node.getTypeArguments().length === 0) {
      const args = node.getArguments();
      if (args.length > 0 && Node.isObjectLiteralExpression(args[0])) {
        objectProps = await mergeSetupObjectProps(args[0], importedObjectRefs, visitedImports);
      }
    }
  }

  return objectProps;
}

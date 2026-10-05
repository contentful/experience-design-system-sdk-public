import { Node, Project } from 'ts-morph';

export function createAstroFrontmatterProject(): Project {
  return new Project({
    compilerOptions: { strict: false, target: 99, module: 99, allowJs: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
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

export function extractBindingPropName(element: import('ts-morph').BindingElement): string | null {
  if (element.getText().startsWith('...')) return null;
  return element.getPropertyNameNode()?.getText() ?? element.getNameNode().getText();
}

export function collectAstroPropsBindings(
  frontmatter: string,
): import('ts-morph').BindingElement[] {
  const elements: import('ts-morph').BindingElement[] = [];
  const sf = createAstroFrontmatterProject().createSourceFile('__frontmatter__.ts', frontmatter);
  sf.forEachDescendant((node) => {
    if (!Node.isVariableDeclaration(node)) return;
    const initializer = node.getInitializer();
    if (!initializer || !usesAstroProps(initializer)) return;
    const nameNode = node.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) return;
    for (const element of nameNode.getElements()) elements.push(element);
  });
  return elements;
}

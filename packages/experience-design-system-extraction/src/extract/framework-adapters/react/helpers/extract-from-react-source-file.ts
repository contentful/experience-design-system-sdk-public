import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { ExtractionExclusion } from '../../../types/component.js';
import { getRenderableExports } from '../../shared/helpers/tsx-shared.js';
import { extractReactComponentFromExport, type RawComponentDefinitionInternal } from './extract-react-component-from-export.js';

export function sourceFileUsesCreateContext(sourceFile: SourceFile): boolean {
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
    const expr = call.getExpression();
    const text = expr.getText();
    return text === 'createContext' || text === 'React.createContext';
  });
}

export function extractFromReactSourceFile(
  sourceFile: SourceFile,
  isNext: boolean,
  exclusions: ExtractionExclusion[],
): RawComponentDefinitionInternal[] {
  const components: RawComponentDefinitionInternal[] = [];
  const usesCreateContext = sourceFileUsesCreateContext(sourceFile);

  for (const { name, declarations } of getRenderableExports(sourceFile, exclusions, {
    allowVariableDeclaration: true,
    hookReason: 'React hook names are not renderable components',
  })) {
    const component = extractReactComponentFromExport(name, declarations, sourceFile, isNext, usesCreateContext);
    if (component) components.push(component);
  }

  return components;
}

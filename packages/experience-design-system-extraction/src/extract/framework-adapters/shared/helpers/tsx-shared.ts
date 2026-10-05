import { Project, type SourceFile } from 'ts-morph';
import type { ExtractionExclusion } from '../../../types/component.js';

export {
  kebabToPascal,
  extractAllowedValues,
  isIntrinsicJsxElement,
  getJsxTagNameNode,
  getNodeDefinitions,
  getTypeTargetDeclarations,
  getValueTargetDeclarations,
  getTypeReferenceName,
} from './tsx-node-utils.js';

export { resolveDefaultExportName, getRenderableExports } from './tsx-renderable-exports.js';

function createTsxProject(filePaths: string[]): Project {
  const project = new Project({
    compilerOptions: {
      jsx: 1,
      target: 99,
      module: 99,
      moduleResolution: 100,
      skipLibCheck: true,
      allowJs: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  for (const filePath of filePaths) {
    project.addSourceFileAtPath(filePath);
  }

  return project;
}

function getTsxProjectFiles(filePaths: string[]): string[] {
  return filePaths.filter((filePath) => /\.[jt]sx?$/.test(filePath) && !filePath.endsWith('.d.ts'));
}

export function getTsxExtractionContext(
  filePaths: string[],
  componentFilePattern: RegExp,
): { componentFiles: string[]; project: Project } | undefined {
  const componentFiles = filePaths.filter((filePath) => componentFilePattern.test(filePath));
  if (componentFiles.length === 0) return undefined;

  return {
    componentFiles,
    project: createTsxProject(getTsxProjectFiles(filePaths)),
  };
}

export function extractTsxComponents<T>(
  filePaths: string[],
  componentFilePattern: RegExp,
  extract: (sourceFile: SourceFile, exclusions: ExtractionExclusion[]) => T[],
): {
  components: T[];
  warnings: string[];
  exclusions: ExtractionExclusion[];
  project?: Project;
} {
  const extractionContext = getTsxExtractionContext(filePaths, componentFilePattern);
  if (!extractionContext) {
    return { components: [], warnings: [], exclusions: [] };
  }

  const { componentFiles, project } = extractionContext;
  const components: T[] = [];
  const warnings: string[] = [];
  const exclusions: ExtractionExclusion[] = [];

  for (const filePath of componentFiles) {
    try {
      const sourceFile = project.getSourceFile(filePath);
      if (!sourceFile) continue;
      components.push(...extract(sourceFile, exclusions));
    } catch (e) {
      warnings.push(`Failed to extract from ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { components, warnings, exclusions, project };
}

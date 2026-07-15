import { Project, type SourceFile } from 'ts-morph';

/**
 * Shared ts-morph Project construction for the whole-file extractors
 * (react, vue-tsx, stencil, web-components) and the raw-AST dumper.
 *
 * All four whole-file extractors built a Project with the same base compiler
 * options; the only differences were whether JSX and JS sources were enabled.
 * Centralising the construction keeps those knobs in one place so the AST the
 * dumper sees is byte-for-byte the AST the extractors walk.
 */
export interface ExtractionProjectOptions {
  /** Enable `jsx: Preserve`. Extractors that parse `.tsx` need this; web-components does not. Default true. */
  jsx?: boolean;
  /** Allow `.js`/`.jsx` sources. Default true; web-components disables it. */
  allowJs?: boolean;
}

export function createExtractionProject(options: ExtractionProjectOptions = {}): Project {
  const { jsx = true, allowJs = true } = options;

  return new Project({
    compilerOptions: {
      ...(jsx ? { jsx: 1 } : {}), // JsxEmit.Preserve
      target: 99, // ScriptTarget.ESNext
      module: 99, // ModuleKind.ESNext
      moduleResolution: 100, // ModuleResolutionKind.Bundler
      skipLibCheck: true,
      ...(allowJs ? { allowJs: true } : {}),
    },
    skipAddingFilesFromTsConfig: true,
  });
}

/**
 * Build a Project and add every given path to it. Returns the project plus the
 * loaded SourceFiles (in the same order, skipping any that failed to load).
 */
export function loadTsMorphSourceFiles(
  filePaths: string[],
  options: ExtractionProjectOptions = {},
): { project: Project; sourceFiles: SourceFile[] } {
  const project = createExtractionProject(options);
  const sourceFiles: SourceFile[] = [];

  for (const filePath of filePaths) {
    const sourceFile = project.addSourceFileAtPath(filePath);
    sourceFiles.push(sourceFile);
  }

  return { project, sourceFiles };
}

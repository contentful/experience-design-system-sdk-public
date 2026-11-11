import { importModeLabel, type ImportTarget } from '../00-preflight/logic.js';

// What the debug log says about the Welcome: the project path the user ended up with, and whether they typed it or
// kept the one the import was started with. Nothing typed but not submitted is logged.

/** The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. */
export function welcomeLog({
  mode,
  projectPath,
  initialPath,
  emptySubmits,
}: {
  mode: ImportTarget;
  /** The path the user continued with, or null when they left the import. */
  projectPath: string | null;
  initialPath: string;
  /** How many times Enter was pressed on an empty field, which does nothing and can look like a stuck screen. */
  emptySubmits: number;
}): { summary: string[]; data: Record<string, unknown> } {
  const kept = projectPath !== null && initialPath.trim() !== '' && projectPath === initialPath.trim();
  const source = projectPath === null ? null : kept ? 'prefilled' : 'typed';

  const summary = [
    `Import mode: ${importModeLabel(mode)}`,
    projectPath === null ? 'Project path: none (left the import)' : `Project path: ${projectPath}`,
    ...(source ? [`Path source: ${source === 'prefilled' ? 'pre-filled, kept as is' : 'typed by the user'}`] : []),
    `Empty submits: ${emptySubmits}`,
  ];

  return {
    summary,
    data: { import_mode: mode, project_path: projectPath, path_source: source, empty_submits: emptySubmits },
  };
}

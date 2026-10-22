import { join, resolve } from 'node:path';

export interface FileLocationInput {
  /** The Root Project Directory from Settings > Configuration > Project. Empty when not set. */
  contentfulBaseDir: string;
  /** Whether Debug Mode is on. Debug logs and the per-run folders only exist while it is. */
  debugModeEnabled: boolean;
  /** This terminal session's folder, once it has started. */
  currentSessionDir: string | undefined;
}

export interface FileLocations {
  debugLogs: string;
  importFiles: string;
}

/**
 * Where the CLI writes the files a user goes looking for, from the settings that decide it (see `startImportRun`).
 *
 * With Debug Mode on, everything goes in this terminal session's folder, `<base>/.contentful/<date>-session-N/`:
 * the debug logs in `debug/` and, for each import, a `dsi-import-N/` folder with `tokens.json` and `components.json`.
 * `<base>` is the Root Project Directory, or the project being imported when none is set. With Debug Mode off there is
 * no session folder and no logs, and the files go to `<project>/.contentful/`.
 *
 * Names that are only known when a session or an import starts are shown as patterns, never guessed.
 */
export function describeFileLocations({
  contentfulBaseDir,
  debugModeEnabled,
  currentSessionDir,
}: FileLocationInput): FileLocations {
  if (!debugModeEnabled) {
    return {
      debugLogs: 'none while Debug Mode is off',
      importFiles: `${join('<project>', '.contentful')}/ (tokens.json, components.json)`,
    };
  }

  const base = contentfulBaseDir ? resolve(contentfulBaseDir) : '<project>';
  const session = currentSessionDir ?? join(base, '.contentful', '<date>-session-<n>');
  return {
    debugLogs: join(session, 'debug'),
    importFiles: `${join(session, 'dsi-import-<n>')}/ (tokens.json, components.json)`,
  };
}

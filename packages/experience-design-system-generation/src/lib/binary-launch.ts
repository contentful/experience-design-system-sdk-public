/**
 * Cross-platform binary lookup and launch.
 *
 * Two separate Windows problems live here, and they need different fixes:
 *
 *  1. LOOKUP. libuv's spawn only tries `.com` and `.exe` when resolving a bare
 *     command name against PATH — it ignores PATHEXT. Every tool installed via
 *     npm (`claude`, `codex`, `pnpm`) is a `.cmd` shim on Windows, so a bare
 *     name resolves to nothing and spawn fails with ENOENT. `findBinary` walks
 *     PATH itself and tries the Windows executable extensions.
 *
 *  2. LAUNCH. Even with the full path, Node refuses to start a `.bat`/`.cmd`
 *     directly — it throws EINVAL (a deliberate guard added for CVE-2024-27980).
 *     Such a file has to run through `cmd.exe /d /s /c`. `spawnSpec` builds that
 *     argv.
 *
 * Both take `platform` as an argument so tests can assert Windows behaviour
 * while running on macOS or Linux.
 */
import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * Executable suffixes to try for a bare command name. The POSIX case is a
 * single empty string: the name is already the whole filename.
 */
function executableExtensions(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['.exe', '.cmd', '.bat', '.com'] : [''];
}

/**
 * Resolve a command to an absolute path, or null when it isn't on PATH.
 *
 * Replaces shelling out to `which`, which doesn't exist on Windows. An absolute
 * path is checked directly — on Windows `which` wouldn't resolve one anyway, and
 * `isAbsolute` recognises `C:\...` where a `startsWith('/')` test does not.
 */
export function findBinary(binary: string, platform: NodeJS.Platform = process.platform): string | null {
  const extensions = executableExtensions(platform);

  if (isAbsolute(binary)) {
    // An explicit path may already carry its extension, or (on Windows) omit it.
    for (const extension of ['', ...extensions]) {
      try {
        accessSync(binary + extension, constants.F_OK);
        return binary + extension;
      } catch {
        continue;
      }
    }
    return null;
  }

  for (const directory of (process.env['PATH'] ?? '').split(delimiter)) {
    // Skip empty and relative PATH entries: resolving a command against the cwd
    // would make the result depend on where the CLI happens to be run from.
    if (!directory || !isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const candidate = join(directory, binary + extension);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** True when `binary` resolves to something executable. */
export function binaryExists(binary: string, platform: NodeJS.Platform = process.platform): boolean {
  return findBinary(binary, platform) !== null;
}

export type SpawnSpec = {
  command: string;
  args: string[];
  /** Set when `args` are pre-quoted and Node must pass them through untouched. */
  windowsVerbatimArguments?: boolean;
};

/**
 * Build the argv for launching an already-resolved executable.
 *
 * Off Windows, and for a real `.exe`/`.com`, this passes straight through. A
 * Windows `.cmd`/`.bat` is wrapped in `cmd.exe /d /s /c "..."`, which is the only
 * way to start one.
 *
 * Quoting note: the wrapped form re-parses the command line, so arguments are
 * quoted here. That quoting is deliberately simple — double quotes are doubled
 * and each argument wrapped — which is sufficient because the arguments reaching
 * this path are our own flags and model names. Large or user-controlled text
 * (agent prompts) travels over stdin instead, and must keep doing so. If
 * user-controlled values ever need to go through argv here, replace this with
 * `cross-spawn` rather than extending the escaping: it implements the full
 * cmd.exe rules, including the double-escaping that `node_modules/.bin` shims
 * require.
 */
export function spawnSpec(resolved: string, args: string[], platform: NodeJS.Platform = process.platform): SpawnSpec {
  if (platform !== 'win32' || /\.(exe|com)$/i.test(resolved)) {
    return { command: resolved, args };
  }

  // `||` not `??`: an empty ComSpec is as unusable as an absent one.
  const shell = process.env['ComSpec'] || 'cmd.exe';
  const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const commandLine = [resolved, ...args].map(quote).join(' ');
  return {
    command: shell,
    // /d skips AutoRun scripts, /s keeps the outer quotes intact, /c runs and exits.
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Resolve a command and build its launch spec in one step. Returns null when the
 * command isn't installed, so callers can report that distinctly from a failure
 * to run.
 */
export function resolveSpawn(
  binary: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): SpawnSpec | null {
  const resolved = findBinary(binary, platform);
  if (!resolved) return null;
  return spawnSpec(resolved, args, platform);
}

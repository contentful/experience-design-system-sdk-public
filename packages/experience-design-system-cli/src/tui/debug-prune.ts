import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

// The folders the logger creates: <base>/.contentful/MM-DD-YYYY-session-N/debug/.
const SESSION_FOLDER = /^\d{2}-\d{2}-\d{4}-session-\d+$/;

async function logFilesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return logFilesIn(path);
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
    }),
  );
  return nested.flat();
}

// Removes `from` and then each parent up to and including `stop`, as long as each one is empty. `rmdir` refuses a folder
// that still has anything in it, so this cannot delete a file; the first folder that is not empty ends the walk.
async function removeEmptyFolders(from: string, stop: string): Promise<void> {
  let dir = from;
  for (;;) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
    if (dir === stop) return;
    dir = dirname(dir);
  }
}

/**
 * Deletes the debug logs under `<base>/.contentful` that are older than `retentionDays`. It only looks at `.md` files
 * inside the `debug` folder of a session folder, so nothing the import produced or the user put there is touched. A file
 * that cannot be read or deleted is skipped: this runs at startup and must never get in the user's way. A folder the
 * deletion left empty is removed too, up to the session folder; one that still holds anything stays. Returns how many
 * logs it deleted.
 */
export async function pruneExpiredLogs(base: string, retentionDays: number, now: number = Date.now()): Promise<number> {
  const cutoff = now - retentionDays * DAY_MS;
  const contentfulDir = join(base, '.contentful');
  let deleted = 0;
  try {
    const sessions = (await readdir(contentfulDir)).filter((name) => SESSION_FOLDER.test(name));
    for (const session of sessions) {
      const files = await logFilesIn(join(contentfulDir, session, 'debug')).catch(() => []);
      for (const file of files) {
        try {
          if ((await stat(file)).mtimeMs >= cutoff) continue;
          await rm(file);
          deleted += 1;
          await removeEmptyFolders(dirname(file), join(contentfulDir, session));
        } catch {
          // Skip a log that cannot be checked or removed.
        }
      }
    }
  } catch {
    // No `.contentful` folder yet, so there is nothing to delete.
  }
  return deleted;
}

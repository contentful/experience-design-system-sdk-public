import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

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

/**
 * Deletes the debug logs under `<base>/.contentful` that are older than `retentionDays`. It only looks at `.md` files
 * inside the `debug` folder of a session folder, so nothing the import produced or the user put there is touched. A file
 * that cannot be read or deleted is skipped: this runs at startup and must never get in the user's way. Returns how many
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

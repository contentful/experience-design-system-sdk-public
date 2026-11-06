import { spawn } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { currentDebugSessionDir, currentSessionDir, settleDebugLogs } from './debug-store.js';
import { createZip, type ZipEntry } from './zip.js';

// What the user sends to Contentful support when an import fails: this terminal session's debug logs in one zip.

export type SupportBundle =
  | { status: 'created'; path: string; files: number }
  /** There are no debug logs to send, which is what Debug Mode being off looks like. */
  | { status: 'no-logs' }
  /** The zip could not be made. The logs are still in `folder`. */
  | { status: 'failed'; folder: string };

/**
 * Zips this session's debug logs, in the folder layout they have on disk, into the session folder next to `debug/`. The
 * zip is not inside `debug/`, so it is never zipped into itself and the log cleanup leaves it alone. It waits for logs
 * that are still being written, so the step that just failed is in it. Making the zip never throws: it is offered on the
 * screen that explains an error, and must not replace that error with another.
 */
export async function bundleDebugLogs(): Promise<SupportBundle> {
  const session = currentSessionDir();
  const debugDir = currentDebugSessionDir();
  if (!session || !debugDir) return { status: 'no-logs' };

  try {
    await settleDebugLogs();
    const logs = (await readdir(debugDir, { recursive: true })).filter((file) => file.endsWith('.md')).sort();
    if (logs.length === 0) return { status: 'no-logs' };

    const entries: ZipEntry[] = await Promise.all(
      logs.map(async (file) => {
        const path = join(debugDir, file);
        return { name: file.split(sep).join('/'), data: await readFile(path), modified: (await stat(path)).mtime };
      }),
    );
    const path = join(session, `${basename(session)}-debug-logs.zip`);
    await writeFile(path, createZip(entries), { mode: 0o600 });
    return { status: 'created', path, files: entries.length };
  } catch {
    return { status: 'failed', folder: debugDir };
  }
}

/** Shows the zip (or, if there is none, the debug folder) in Finder or File Explorer. Best effort: a failure is ignored. */
export function openSupportBundle(bundle: SupportBundle): void {
  if (bundle.status === 'no-logs') return;
  const target = bundle.status === 'created' ? bundle.path : bundle.folder;
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: bundle.status === 'created' ? ['-R', target] : [target] }
      : process.platform === 'win32'
        ? { file: 'explorer.exe', args: bundle.status === 'created' ? [`/select,${target}`] : [target] }
        : { file: 'xdg-open', args: [bundle.status === 'created' ? dirname(target) : target] };
  try {
    const child = spawn(command.file, command.args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // there is no file manager to open; the path on screen is still enough
  }
}

/** What the error screen says about the logs, in one short instruction. */
export function supportInstruction(bundle: SupportBundle): string {
  switch (bundle.status) {
    case 'created':
      return `Debug logs saved to ${bundle.path}\nSend this file to Contentful support so they can look into it.`;
    case 'no-logs':
      return 'No debug logs were recorded. To get help, turn on Debug Mode in Settings, run the import again and send the zip file it saves to Contentful support.';
    case 'failed':
      return `Your debug logs are in ${bundle.folder}\nZip that folder and send it to Contentful support so they can look into it.`;
  }
}

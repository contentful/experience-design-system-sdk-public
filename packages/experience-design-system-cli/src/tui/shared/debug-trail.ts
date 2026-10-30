import { existsSync } from 'node:fs';
import { configFilePath } from '@contentful/experience-design-system-types/config';

// What a Settings screen writes to its debug log, beyond the values it opened and closed with, so a log a user sends us
// is enough to reproduce a problem and diagnose it without a call:
//
//   changed / changed_fields   whether the visit changed anything, and which fields (names only, never values)
//   actions                    a short ordered list of what the user did, so the visit can be replayed
//   error                      the message of a failed load or save, with any secret scrubbed out of it
//
// Project and Agents both use it, so the two logs read the same way.

/** One screen's values, as flat text, taken when the screen opens and again when it closes. */
export type Snapshot = Record<string, string>;

export type Change = {
  changed: boolean;
  /** Field names that differ between the two snapshots, in the order the fields appear. Never the values. */
  changed_fields: string[];
};

/**
 * Compares the snapshot taken on entry with the one taken on exit. A field that exists in only one of them counts as
 * changed. Only names are returned, so the result can be logged without repeating a secret.
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): Change {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed_fields = names.filter((name) => before[name] !== after[name]);
  return { changed: changed_fields.length > 0, changed_fields };
}

export type Trail = {
  /** Adds one action, such as `edited spaceId`, `saved`, or `made Codex the default`. Field names, never values. */
  record(action: string): void;
  /** The recorded actions in order, oldest first. Once the limit is passed the oldest are dropped. */
  entries(): string[];
};

const DEFAULT_TRAIL_LIMIT = 30;

/** Keeps the last `limit` actions of a visit, so a long visit cannot make the log grow without bound. */
export function createTrail(limit = DEFAULT_TRAIL_LIMIT): Trail {
  const actions: string[] = [];
  return {
    record(action) {
      actions.push(action);
      if (actions.length > limit) actions.shift();
    },
    entries: () => [...actions],
  };
}

// A secret shorter than this is more likely an ordinary word than a credential, and replacing it would mangle the message.
const MIN_SECRET_LENGTH = 6;

/**
 * The message of a failed load or save, safe to log: any of `secrets` that appears in it is replaced. The CMA token is
 * only redacted by key elsewhere, so an error that quotes it would otherwise get through. A secret is matched as it is
 * and as it looks URL-encoded, which is how it appears in a request error.
 */
export function scrubError(error: unknown, secrets: readonly string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    for (const form of new Set([secret, encodeURIComponent(secret)])) message = message.split(form).join('[redacted]');
  }
  return message;
}

/**
 * Where Project's settings live and what could be moving them: the settings file path, whether `EDS_HOME` relocated it,
 * and whether the file exists. Facts for the log, with no values read from the file.
 */
export function describeSettingsFile(): { path: string; eds_home_set: boolean; exists: boolean } {
  const path = configFilePath();
  return { path, eds_home_set: Boolean(process.env['EDS_HOME']), exists: existsSync(path) };
}

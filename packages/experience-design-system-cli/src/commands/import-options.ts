// The flags `experiences import` takes. `--project` and `--tokens` are not here: the TUI collects those on its own screens.
export interface ImportOptions {
  agent?: string;
  prompt: string[];
  cache: boolean;
  debugResume?: string;
  debugFrom?: string;
  debugOutput?: string;
}

interface RawImportOptions {
  agent?: string;
  prompt?: string[];
  // Commander turns `--no-cache` into `cache: false`; it is true when the flag is absent.
  cache?: boolean;
  debugResume?: string | boolean;
  debugFrom?: string;
  debugOutput?: string;
}

export function toImportOptions(raw: RawImportOptions): ImportOptions {
  return {
    ...(raw.agent ? { agent: raw.agent } : {}),
    prompt: raw.prompt ?? [],
    cache: raw.cache !== false,
    ...(raw.debugResume ? { debugResume: typeof raw.debugResume === 'string' ? raw.debugResume : 'latest' } : {}),
    ...(raw.debugFrom ? { debugFrom: raw.debugFrom } : {}),
    ...(raw.debugOutput ? { debugOutput: raw.debugOutput } : {}),
  };
}

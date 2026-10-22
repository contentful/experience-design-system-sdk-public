// The flags `experiences import` takes. `--project` and `--tokens` are not here: the TUI collects those on its own screens.
export interface ImportOptions {
  agent?: string;
  prompt: string[];
}

interface RawImportOptions {
  agent?: string;
  prompt?: string[];
}

export function toImportOptions(raw: RawImportOptions): ImportOptions {
  return {
    ...(raw.agent ? { agent: raw.agent } : {}),
    prompt: raw.prompt ?? [],
  };
}

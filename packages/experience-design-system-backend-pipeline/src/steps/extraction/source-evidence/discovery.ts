import { createHash } from 'node:crypto';
import { canonicalSourceFactPath } from '../src/candidates/bind-source-candidates.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface SourceDiscoveryLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDirectories: number;
  maxDirectoryEntries: number;
  maxReadAttempts: number;
  maxDepth: number;
  maxDiscoveryMs: number;
}
export const DEFAULT_SOURCE_DISCOVERY_LIMITS: Readonly<SourceDiscoveryLimits> = {
  maxFiles: 256,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxDirectories: 256,
  maxDirectoryEntries: 4096,
  maxReadAttempts: 1024,
  maxDepth: 12,
  maxDiscoveryMs: 10_000,
};
export interface SourceEvidenceInventory {
  schemaVersion: 1;
  projectRoot: string;
  selectedSourcePaths: string[];
  files: Array<{
    canonicalPath: string;
    textHash: string;
    byteLength: number;
    roles: string[];
    format: string;
    origin: 'unknown';
    readSource: 'filesystem' | 'compiler';
    text: string;
  }>;
  packages: Array<{
    path: string;
    textHash: string;
    status: 'available' | 'invalid';
    name: string | null;
    version: string | null;
    packageManager: string | null;
    scripts: Record<string, string>;
    missing: string[];
    reasons: string[];
  }>;
  sourceMaps: Array<{
    path: string;
    textHash: string;
    status: 'available' | 'invalid' | 'unsupported';
    generatedPath: string | null;
    sources: Array<{
      path: string;
      status: 'file' | 'embedded' | 'unavailable';
      textHash: string | null;
      text: string | null;
    }>;
    reasons: string[];
  }>;
  omissions: Array<{ path: string; reason: string }>;
  coverage: 'partial' | 'unavailable' | 'complete-within-declared-bound';
  bounds: {
    limits: SourceDiscoveryLimits;
    used: {
      files: number;
      totalBytes: number;
      directories: number;
      directoryEntries: number;
      readAttempts: number;
      depth: number;
      discoveryMs: number;
    };
  };
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function isWithinEvidenceRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
const canonical = canonicalSourceFactPath;
const textFormats = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.md',
  '.mdx',
  '.json',
  '.map',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.scss',
  '.txt',
]);
export function canonicalSelectedSourcePaths(projectRoot: string, paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => canonical(isAbsolute(path) ? path : resolve(projectRoot, path))))].sort();
}

export function discoverSourceEvidence(request: {
  projectRoot: string;
  filePaths: readonly string[];
  evidenceFilePaths?: readonly string[];
  limits?: Partial<SourceDiscoveryLimits>;
  signal?: AbortSignal;
}): SourceEvidenceInventory {
  const limits = { ...DEFAULT_SOURCE_DISCOVERY_LIMITS };
  for (const key of Object.keys(limits) as Array<keyof SourceDiscoveryLimits>) {
    const value = request.limits?.[key];
    if (value !== undefined && Number.isFinite(value) && value >= 0) limits[key] = Math.floor(value);
  }
  const projectRoot = canonical(request.projectRoot);
  const selectedSourcePaths = canonicalSelectedSourcePaths(projectRoot, request.filePaths);
  const selected = new Set(selectedSourcePaths);
  const result: SourceEvidenceInventory = {
    schemaVersion: 1,
    projectRoot,
    selectedSourcePaths,
    files: [],
    packages: [],
    sourceMaps: [],
    omissions: [],
    coverage: 'partial',
    bounds: {
      limits,
      used: { files: 0, totalBytes: 0, directories: 0, directoryEntries: 0, readAttempts: 0, depth: 0, discoveryMs: 0 },
    },
  };
  const used = result.bounds.used;
  const started = Date.now();
  const seen = new Set<string>();
  const dirs = new Set<string>();
  const omit = (path: string, reason: string) => result.omissions.push({ path, reason });
  const budget = (path: string) => {
    if (request.signal?.aborted) {
      const error = new Error('Source discovery aborted');
      error.name = 'AbortError';
      throw error;
    }
    if (Date.now() - started > limits.maxDiscoveryMs) {
      omit(path, 'max-discovery-ms');
      return false;
    }
    return true;
  };
  function admit(path: string, depth: number) {
    if (!budget(path)) return;
    const real = canonical(path);
    if (!isWithinEvidenceRoot(projectRoot, real)) {
      omit(path, 'outside-project-root');
      return;
    }
    if (relative(projectRoot, real).split(sep).includes('.contentful')) {
      omit(path, 'import-output-excluded');
      return;
    }
    if (
      relative(projectRoot, real)
        .split(sep)
        .some((part) => part === 'node_modules' || part === '.pnpm' || part === '.git')
    ) {
      omit(path, 'dependency-or-git-tree-excluded');
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    if (used.readAttempts >= limits.maxReadAttempts) {
      omit(path, 'max-read-attempts');
      return;
    }
    used.readAttempts++;
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(real);
    } catch {
      omit(path, 'source-unavailable');
      return;
    }
    if (stat.isDirectory()) {
      if (dirs.has(real)) return;
      dirs.add(real);
      if (depth > limits.maxDepth) {
        omit(path, 'max-directory-depth');
        return;
      }
      used.depth = Math.max(used.depth, depth);
      if (used.directories >= limits.maxDirectories) {
        omit(path, 'max-directories');
        return;
      }
      used.directories++;
      let entries: string[];
      try {
        entries = readdirSync(real).sort();
      } catch {
        omit(path, 'directory-unreadable');
        return;
      }
      const remaining = Math.max(0, limits.maxDirectoryEntries - used.directoryEntries);
      if (entries.length > remaining) omit(path, 'max-directory-entries');
      used.directoryEntries += Math.min(entries.length, remaining);
      for (const entry of entries.slice(0, remaining)) admit(resolve(real, entry), depth + 1);
      return;
    }
    if (!stat.isFile()) {
      omit(path, 'unsupported-file-kind');
      return;
    }
    const format = extname(real).toLowerCase();
    if (!textFormats.has(format)) {
      omit(path, 'unsupported-text-format');
      return;
    }
    if (used.files >= limits.maxFiles) {
      omit(path, 'max-files');
      return;
    }
    if (stat.size > limits.maxFileBytes) {
      omit(path, 'max-file-bytes');
      return;
    }
    if (used.totalBytes + stat.size > limits.maxTotalBytes) {
      omit(path, 'max-total-bytes');
      return;
    }
    let text: string;
    try {
      text = readFileSync(real, 'utf8');
      const after = statSync(real);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
        omit(path, 'source-changed-during-read');
        return;
      }
    } catch {
      omit(path, 'source-unreadable');
      return;
    }
    if (text.includes('\u0000')) {
      omit(path, 'unsupported-binary-content');
      return;
    }
    const byteLength = Buffer.byteLength(text);
    if (byteLength > limits.maxFileBytes || used.totalBytes + byteLength > limits.maxTotalBytes) {
      omit(path, 'decoded-byte-budget');
      return;
    }
    used.files++;
    used.totalBytes += byteLength;
    const roles = [selected.has(real) ? 'selected' : 'context'];
    if (/(?:^|\.)stories?\.[^.]+$/.test(real)) roles.push('story');
    if (/(?:^|\.)(?:test|spec)\.[^.]+$/.test(real)) roles.push('test');
    if (relative(projectRoot, real).split(sep).includes('examples')) roles.push('example');
    result.files.push({
      canonicalPath: real,
      textHash: hash(text),
      byteLength,
      roles,
      format,
      origin: 'unknown',
      readSource: 'filesystem',
      text,
    });
  }
  // Explicit selections are admitted first; broader context cannot consume their budget.
  for (const path of selectedSourcePaths) admit(path, 0);
  if (request.evidenceFilePaths)
    for (const path of [...request.evidenceFilePaths].sort())
      admit(isAbsolute(path) ? path : resolve(projectRoot, path), 0);
  else admit(projectRoot, 0);
  if (request.evidenceFilePaths) {
    for (const file of [...result.files]) {
      let directory = dirname(file.canonicalPath);
      let found = false;
      for (let depth = 0; depth <= limits.maxDepth && isWithinEvidenceRoot(projectRoot, directory); depth++) {
        const manifest = resolve(directory, 'package.json');
        if (used.readAttempts >= limits.maxReadAttempts) {
          omit(manifest, 'max-read-attempts');
          break;
        }
        used.readAttempts++;
        try {
          if (statSync(manifest).isFile()) {
            admit(manifest, 0);
            found = true;
            break;
          }
        } catch {
          /* Missing metadata does not invent a package. */
        }
        if (directory === projectRoot) break;
        directory = dirname(directory);
      }
      if (!found) omit(file.canonicalPath, 'nearest-package-metadata-unavailable-or-absent');
    }
  }
  result.files.sort((a, b) => a.canonicalPath.localeCompare(b.canonicalPath));
  const byPath = new Map(result.files.map((file) => [file.canonicalPath, file]));
  for (const file of result.files) {
    if (file.canonicalPath.endsWith(`${sep}package.json`)) {
      const pkg: SourceEvidenceInventory['packages'][number] = {
        path: file.canonicalPath,
        textHash: file.textHash,
        status: 'available',
        name: null,
        version: null,
        packageManager: null,
        scripts: {},
        missing: [],
        reasons: [],
      };
      try {
        const value: unknown = JSON.parse(file.text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const object = value as Record<string, unknown>;
        for (const key of ['name', 'version', 'packageManager'] as const) {
          if (typeof object[key] === 'string') pkg[key] = object[key];
          else pkg.missing.push(key);
        }
        if (object.scripts && typeof object.scripts === 'object' && !Array.isArray(object.scripts)) {
          for (const [key, value] of Object.entries(object.scripts))
            if (typeof value === 'string') Object.defineProperty(pkg.scripts, key, { value, enumerable: true });
            else pkg.reasons.push(`nonliteral-script:${key}`);
        } else pkg.missing.push('scripts');
      } catch {
        pkg.status = 'invalid';
        pkg.reasons.push('invalid-package-metadata');
      }
      result.packages.push(pkg);
    }
    if (file.format === '.map') {
      const map: SourceEvidenceInventory['sourceMaps'][number] = {
        path: file.canonicalPath,
        textHash: file.textHash,
        status: 'available',
        generatedPath: null,
        sources: [],
        reasons: [],
      };
      try {
        const value = JSON.parse(file.text) as Record<string, unknown>;
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          !Array.isArray(value.sources) ||
          !value.sources.every((source) => typeof source === 'string')
        )
          throw new Error();
        if (value.version !== 3) {
          map.status = 'unsupported';
          map.reasons.push('unsupported-map-version');
        } else {
          const mapRoot = typeof value.sourceRoot === 'string' ? value.sourceRoot : '';
          map.generatedPath = typeof value.file === 'string' ? resolve(dirname(file.canonicalPath), value.file) : null;
          for (const [i, source] of value.sources.entries()) {
            const path = resolve(dirname(file.canonicalPath), mapRoot, source as string);
            const embedded = Array.isArray(value.sourcesContent) ? value.sourcesContent[i] : null;
            const admitted = byPath.get(canonical(path));
            map.sources.push(
              typeof embedded === 'string'
                ? { path, status: 'embedded', textHash: hash(embedded), text: embedded }
                : admitted
                  ? { path: admitted.canonicalPath, status: 'file', textHash: admitted.textHash, text: null }
                  : { path, status: 'unavailable', textHash: null, text: null },
            );
          }
        }
      } catch {
        map.status = 'invalid';
        map.reasons.push('invalid-source-map');
      }
      result.sourceMaps.push(map);
    }
  }
  result.omissions.sort((a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason));
  used.discoveryMs = Date.now() - started;
  result.coverage = result.files.length ? 'partial' : 'unavailable';
  return result;
}

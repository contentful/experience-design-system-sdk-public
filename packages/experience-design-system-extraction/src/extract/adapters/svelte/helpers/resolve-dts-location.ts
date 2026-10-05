import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

function extractTypesFromExports(exportsField: unknown): string | null {
  if (!exportsField || typeof exportsField !== 'object') return null;
  const exp = exportsField as Record<string, unknown>;
  const root = (exp['.'] ?? exp) as unknown;
  if (!root || typeof root !== 'object') return null;
  const r = root as Record<string, unknown>;
  if (typeof r['types'] === 'string') return r['types'];
  for (const key of ['import', 'default', 'node']) {
    const sub = r[key];
    if (sub && typeof sub === 'object') {
      const t = (sub as Record<string, unknown>)['types'];
      if (typeof t === 'string') return t;
    }
  }
  return null;
}

function findPackageRootForSpecifier(seedDir: string, specifier: string): string | null {
  let dir = seedDir;
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      try {
        const pkgRaw = readFileSync(join(dir, 'package.json'), 'utf-8') as string;
        const pkg = JSON.parse(pkgRaw) as { name?: string };
        if (pkg.name === specifier) return dir;
        if (pkg.name && specifier.startsWith(`${pkg.name}/`)) return dir;
      } catch {}
    }
    const parent = dirname(dir);
    if (!parent || parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function locateDtsForSpecifier(req: NodeJS.Require, specifier: string, parentFile: string): string | null {
  let resolvedJs: string | null = null;
  try {
    resolvedJs = req.resolve(specifier);
  } catch {
    resolvedJs = null;
  }

  const seedDir = resolvedJs ? dirname(resolvedJs) : dirname(parentFile);
  const pkgRoot = findPackageRootForSpecifier(seedDir, specifier);
  if (pkgRoot) {
    const pkgJsonPath = join(pkgRoot, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgRaw = readFileSync(pkgJsonPath, 'utf-8') as string;
        const pkg = JSON.parse(pkgRaw) as { types?: string; typings?: string; exports?: unknown };
        const typesField = pkg.types ?? pkg.typings;
        if (typeof typesField === 'string') {
          const candidate = resolve(pkgRoot, typesField);
          if (existsSync(candidate)) return candidate;
        }
        const exportsTypes = extractTypesFromExports(pkg.exports);
        if (exportsTypes) {
          const candidate = resolve(pkgRoot, exportsTypes);
          if (existsSync(candidate)) return candidate;
        }
      } catch {}
    }
    for (const entry of ['index.d.ts', 'index.d.mts']) {
      const candidate = join(pkgRoot, entry);
      if (existsSync(candidate)) return candidate;
    }
  }

  if (resolvedJs) {
    const noExt = resolvedJs.replace(/\.(m?js|cjs)$/, '');
    for (const ext of ['.d.ts', '.d.mts']) {
      const candidate = `${noExt}${ext}`;
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

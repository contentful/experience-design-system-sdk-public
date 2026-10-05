import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const workspaceRootCache = new Map<string, string | null>();

function findWorkspaceRoot(startDir: string): string | null {
  if (workspaceRootCache.has(startDir)) return workspaceRootCache.get(startDir)!;

  let dir = startDir;
  while (true) {
    const pkgJsonPath = join(dir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (pkg.workspaces || existsSync(join(dir, 'pnpm-workspace.yaml'))) {
          workspaceRootCache.set(startDir, dir);
          return dir;
        }
      } catch {
        /* skip malformed */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      workspaceRootCache.set(startDir, null);
      return null;
    }
    dir = parent;
  }
}

const workspacePackageDirsCache = new Map<string, Map<string, string>>();

function collectWorkspacePackageDirs(workspaceRoot: string): Map<string, string> {
  if (workspacePackageDirsCache.has(workspaceRoot)) {
    return workspacePackageDirsCache.get(workspaceRoot)!;
  }

  const packageMap = new Map<string, string>();
  const packagesDir = join(workspaceRoot, 'packages');

  if (!existsSync(packagesDir)) {
    workspacePackageDirsCache.set(workspaceRoot, packageMap);
    return packageMap;
  }

  function scanDir(dir: string, depth: number): void {
    if (depth > 3) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    const pkgJsonPath = join(dir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (typeof pkg.name === 'string') {
          packageMap.set(pkg.name, dir);
        }
      } catch {
        /* skip */
      }
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;
      const entryPath = join(dir, entry);
      try {
        if (statSync(entryPath).isDirectory()) scanDir(entryPath, depth + 1);
      } catch {
        /* skip */
      }
    }
  }

  scanDir(packagesDir, 0);
  workspacePackageDirsCache.set(workspaceRoot, packageMap);
  return packageMap;
}

/**
 * Resolves a bare module specifier (e.g. "primevue/select") to a .vue file within
 * the same monorepo workspace. Returns null when no match is found.
 */
export function resolveWorkspaceVueImport(specifier: string, importingFilePath: string): string | null {
  const workspaceRoot = findWorkspaceRoot(dirname(importingFilePath));
  if (!workspaceRoot) return null;

  const packageDirs = collectWorkspacePackageDirs(workspaceRoot);

  let packageName: string;
  let subpath: string;

  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length < 2) return null;
    packageName = `${parts[0]}/${parts[1]}`;
    subpath = parts.length > 2 ? './' + parts.slice(2).join('/') : '.';
  } else {
    const slashIndex = specifier.indexOf('/');
    if (slashIndex === -1) {
      packageName = specifier;
      subpath = '.';
    } else {
      packageName = specifier.substring(0, slashIndex);
      subpath = './' + specifier.substring(slashIndex + 1);
    }
  }

  const packageDir = packageDirs.get(packageName);
  if (!packageDir) return null;

  const pkgJsonPath = join(packageDir, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

    if (pkg.exports && subpath !== '.') {
      const exportValue = pkg.exports[subpath];
      if (typeof exportValue === 'string' && exportValue.endsWith('.vue')) {
        const resolved = resolve(packageDir, exportValue);
        if (existsSync(resolved)) return resolved;
      }
    }

    if (subpath !== '.') {
      const subDir = resolve(packageDir, subpath.replace(/^\.\//, ''));
      for (const base of [join(packageDir, 'src', subpath.replace(/^\.\//, '')), subDir]) {
        const subPkgPath = join(base, 'package.json');
        if (existsSync(subPkgPath)) {
          try {
            const subPkg = JSON.parse(readFileSync(subPkgPath, 'utf8'));
            const main = subPkg.main || subPkg.module;
            if (typeof main === 'string' && main.endsWith('.vue')) {
              const resolved = resolve(base, main);
              if (existsSync(resolved)) return resolved;
            }
          } catch {
            /* skip */
          }
        }
      }
    }

    if (subpath === '.') {
      const main = pkg.main || pkg.module;
      if (typeof main === 'string' && main.endsWith('.vue')) {
        const resolved = resolve(packageDir, main);
        if (existsSync(resolved)) return resolved;
      }
    }
  } catch {
    /* skip malformed */
  }

  return null;
}

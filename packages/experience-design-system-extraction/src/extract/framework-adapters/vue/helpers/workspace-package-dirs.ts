import { dirname, join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const workspaceRootCache = new Map<string, string | null>();

export function findWorkspaceRoot(startDir: string): string | null {
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

export function collectWorkspacePackageDirs(workspaceRoot: string): Map<string, string> {
  if (workspacePackageDirsCache.has(workspaceRoot)) return workspacePackageDirsCache.get(workspaceRoot)!;

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
        if (typeof pkg.name === 'string') packageMap.set(pkg.name, dir);
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

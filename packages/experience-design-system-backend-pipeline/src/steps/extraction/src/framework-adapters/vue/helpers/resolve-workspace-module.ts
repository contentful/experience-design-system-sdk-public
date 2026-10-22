import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { findWorkspaceRoot, collectWorkspacePackageDirs } from './workspace-package-dirs.js';

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

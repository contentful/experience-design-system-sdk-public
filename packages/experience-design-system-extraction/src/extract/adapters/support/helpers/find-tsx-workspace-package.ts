import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SourceFile } from 'ts-morph';

type WorkspacePackageManifest = { name: string; rootDir: string };

const packageRootByFilePathCache = new Map<string, string | null>();
const workspacePackageManifestCache = new Map<string, WorkspacePackageManifest | null>();

function findNearestPackageRootDir(filePath: string): string | undefined {
  if (packageRootByFilePathCache.has(filePath)) return packageRootByFilePathCache.get(filePath) ?? undefined;
  let currentDir = dirname(filePath);
  while (true) {
    if (existsSync(join(currentDir, 'package.json'))) {
      packageRootByFilePathCache.set(filePath, currentDir);
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) { packageRootByFilePathCache.set(filePath, null); return undefined; }
    currentDir = parentDir;
  }
}

function getWorkspacePackageManifestForSourceFile(sourceFile: SourceFile): WorkspacePackageManifest | undefined {
  const packageRootDir = findNearestPackageRootDir(sourceFile.getFilePath());
  if (!packageRootDir) return undefined;
  if (workspacePackageManifestCache.has(packageRootDir)) return workspacePackageManifestCache.get(packageRootDir) ?? undefined;
  const packageJsonPath = join(packageRootDir, 'package.json');
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown };
    const manifest = typeof packageJson.name === 'string' ? { name: packageJson.name, rootDir: packageRootDir } : null;
    workspacePackageManifestCache.set(packageRootDir, manifest);
    return manifest ?? undefined;
  } catch {
    workspacePackageManifestCache.set(packageRootDir, null);
    return undefined;
  }
}

export function findWorkspacePackageEntrySourceFile(
  originSourceFile: SourceFile,
  moduleSpecifier: string,
): SourceFile | undefined {
  const project = originSourceFile.getProject();
  const candidateSourceFiles = project.getSourceFiles().filter((sourceFile) => {
    const manifest = getWorkspacePackageManifestForSourceFile(sourceFile);
    return manifest?.name === moduleSpecifier;
  });
  if (candidateSourceFiles.length === 0) return undefined;
  const packageRootDir = getWorkspacePackageManifestForSourceFile(candidateSourceFiles[0]!)?.rootDir;
  if (!packageRootDir) return undefined;
  for (const entryPath of [
    join(packageRootDir, 'src/index.ts'), join(packageRootDir, 'src/index.tsx'),
    join(packageRootDir, 'index.ts'), join(packageRootDir, 'index.tsx'),
  ]) {
    const entrySourceFile = project.getSourceFile(entryPath);
    if (entrySourceFile) return entrySourceFile;
  }
  return candidateSourceFiles.find((sourceFile) => sourceFile.getDirectoryPath() === join(packageRootDir, 'src'));
}

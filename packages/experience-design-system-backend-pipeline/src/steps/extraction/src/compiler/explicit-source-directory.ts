import { basename, dirname, resolve } from 'node:path';
import ts from 'typescript';

const matchFiles = (
  ts as unknown as {
    matchFiles: (
      path: string,
      extensions: readonly string[] | undefined,
      excludes: readonly string[] | undefined,
      includes: readonly string[] | undefined,
      caseSensitive: boolean,
      currentDirectory: string,
      depth: number | undefined,
      entries: (path: string) => { files: string[]; directories: string[] },
      realpath: (path: string) => string,
    ) => string[];
  }
).matchFiles;

export function createExplicitSourceDirectoryReader(paths: readonly string[]): ts.ParseConfigHost['readDirectory'] {
  const directories = new Map<string, { files: Set<string>; directories: Set<string> }>();
  const entries = (path: string) => {
    const key = resolve(path);
    const value = directories.get(key) ?? { files: new Set<string>(), directories: new Set<string>() };
    directories.set(key, value);
    return value;
  };
  for (const path of paths) {
    const file = resolve(path);
    let directory = dirname(file);
    entries(directory).files.add(basename(file));
    while (dirname(directory) !== directory) {
      const parent = dirname(directory);
      entries(parent).directories.add(basename(directory));
      directory = parent;
    }
  }
  return (root, extensions, excludes, includes, depth) =>
    matchFiles(
      root,
      extensions,
      excludes,
      includes,
      ts.sys.useCaseSensitiveFileNames,
      process.cwd(),
      depth,
      (path) => {
        const value = directories.get(resolve(path));
        return { files: [...(value?.files ?? [])].sort(), directories: [...(value?.directories ?? [])].sort() };
      },
      (path) => resolve(path),
    );
}

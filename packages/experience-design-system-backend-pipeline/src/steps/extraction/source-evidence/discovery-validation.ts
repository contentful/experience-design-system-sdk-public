import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { isWithinEvidenceRoot } from './discovery.js';
import type { SourceEvidenceInventory } from './discovery.js';
import { isPlainSourceContract } from '../source-closure/validation.js';
import {
  exactRecord as record,
  sourceArray as array,
  sourceCount as count,
  sourceStrings as strings,
  sourceText as text,
} from './plain-validation.js';
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nullableText = (value: unknown) => value === null || text(value);
export function readSourceInventory(
  value: unknown,
):
  | { status: 'available'; inventory: SourceEvidenceInventory }
  | { status: 'corrupt' | 'unsupported' | 'unknown-legacy' } {
  if (value === undefined) return { status: 'unknown-legacy' };
  if (!isPlainSourceContract(value)) return { status: 'corrupt' };
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1)
    return { status: 'unsupported' };
  if (
    !record(value, [
      'schemaVersion',
      'projectRoot',
      'selectedSourcePaths',
      'files',
      'packages',
      'sourceMaps',
      'omissions',
      'coverage',
      'bounds',
    ]) ||
    value.schemaVersion !== 1 ||
    !text(value.projectRoot) ||
    !strings(value.selectedSourcePaths) ||
    !['partial', 'unavailable', 'complete-within-declared-bound'].includes(value.coverage as string) ||
    !array(
      value.files,
      (file) =>
        record(file, ['canonicalPath', 'textHash', 'byteLength', 'roles', 'format', 'origin', 'readSource', 'text']) &&
        text(file.canonicalPath) &&
        hash(file.textHash) &&
        count(file.byteLength) &&
        strings(file.roles) &&
        text(file.format) &&
        file.origin === 'unknown' &&
        ['filesystem', 'compiler'].includes(file.readSource as string) &&
        text(file.text) &&
        createHash('sha256').update(file.text).digest('hex') === file.textHash &&
        Buffer.byteLength(file.text) === file.byteLength,
    ) ||
    !array(
      value.packages,
      (pkg) =>
        record(pkg, [
          'path',
          'textHash',
          'status',
          'name',
          'version',
          'packageManager',
          'scripts',
          'missing',
          'reasons',
        ]) &&
        text(pkg.path) &&
        hash(pkg.textHash) &&
        ['available', 'invalid'].includes(pkg.status as string) &&
        nullableText(pkg.name) &&
        nullableText(pkg.version) &&
        nullableText(pkg.packageManager) &&
        !!pkg.scripts &&
        typeof pkg.scripts === 'object' &&
        !Array.isArray(pkg.scripts) &&
        Object.values(pkg.scripts).every(text) &&
        strings(pkg.missing) &&
        strings(pkg.reasons),
    ) ||
    !array(
      value.sourceMaps,
      (map) =>
        record(map, ['path', 'textHash', 'status', 'generatedPath', 'sources', 'reasons']) &&
        text(map.path) &&
        hash(map.textHash) &&
        ['available', 'invalid', 'unsupported'].includes(map.status as string) &&
        nullableText(map.generatedPath) &&
        strings(map.reasons) &&
        array(
          map.sources,
          (source) =>
            record(source, ['path', 'status', 'textHash', 'text']) &&
            text(source.path) &&
            ['file', 'embedded', 'unavailable'].includes(source.status as string) &&
            (source.textHash === null || hash(source.textHash)) &&
            nullableText(source.text),
        ),
    ) ||
    !array(value.omissions, (item) => record(item, ['path', 'reason']) && text(item.path) && text(item.reason)) ||
    !record(value.bounds, ['limits', 'used']) ||
    !record(value.bounds.limits, [
      'maxFiles',
      'maxFileBytes',
      'maxTotalBytes',
      'maxDirectories',
      'maxDirectoryEntries',
      'maxReadAttempts',
      'maxDepth',
      'maxDiscoveryMs',
    ]) ||
    !Object.values(value.bounds.limits).every(count) ||
    !record(value.bounds.used, [
      'files',
      'totalBytes',
      'directories',
      'directoryEntries',
      'readAttempts',
      'depth',
      'discoveryMs',
    ]) ||
    !Object.values(value.bounds.used).every(count)
  )
    return { status: 'corrupt' };
  const inventory = value as unknown as SourceEvidenceInventory;
  if (
    inventory.bounds.used.files !== inventory.files.length ||
    inventory.bounds.used.totalBytes !== inventory.files.reduce((sum, file) => sum + file.byteLength, 0) ||
    new Set(inventory.files.map((file) => file.canonicalPath)).size !== inventory.files.length ||
    inventory.files.some((file) => file.byteLength > inventory.bounds.limits.maxFileBytes) ||
    inventory.files.length > inventory.bounds.limits.maxFiles ||
    inventory.bounds.used.totalBytes > inventory.bounds.limits.maxTotalBytes
  )
    return { status: 'corrupt' };
  const paths = new Map(inventory.files.map((file) => [file.canonicalPath, file]));
  if (
    !isAbsolute(inventory.projectRoot) ||
    resolve(inventory.projectRoot) !== inventory.projectRoot ||
    new Set(inventory.selectedSourcePaths).size !== inventory.selectedSourcePaths.length ||
    inventory.selectedSourcePaths.some((path) => !isAbsolute(path) || resolve(path) !== path) ||
    inventory.files.some(
      (file) =>
        !isAbsolute(file.canonicalPath) ||
        resolve(file.canonicalPath) !== file.canonicalPath ||
        !isWithinEvidenceRoot(inventory.projectRoot, file.canonicalPath) ||
        new Set(file.roles).size !== file.roles.length ||
        file.roles.includes('selected') !== inventory.selectedSourcePaths.includes(file.canonicalPath),
    ) ||
    inventory.bounds.used.directories > inventory.bounds.limits.maxDirectories ||
    inventory.bounds.used.directoryEntries > inventory.bounds.limits.maxDirectoryEntries ||
    inventory.bounds.used.readAttempts > inventory.bounds.limits.maxReadAttempts ||
    inventory.bounds.used.depth > inventory.bounds.limits.maxDepth
  )
    return { status: 'corrupt' };
  if (
    new Set(inventory.packages.map((item) => item.path)).size !== inventory.packages.length ||
    new Set(inventory.sourceMaps.map((item) => item.path)).size !== inventory.sourceMaps.length ||
    [...inventory.packages, ...inventory.sourceMaps].some((item) => paths.get(item.path)?.textHash !== item.textHash)
  )
    return { status: 'corrupt' };
  for (const map of inventory.sourceMaps)
    for (const source of map.sources) {
      if (source.status === 'file' && (paths.get(source.path)?.textHash !== source.textHash || source.text !== null))
        return { status: 'corrupt' };
      if (source.status === 'unavailable' && (source.textHash !== null || source.text !== null))
        return { status: 'corrupt' };
    }
  for (const map of inventory.sourceMaps)
    for (const source of map.sources)
      if (
        source.status === 'embedded' &&
        (source.text === null || source.textHash !== createHash('sha256').update(source.text).digest('hex'))
      )
        return { status: 'corrupt' };
  return { status: 'available', inventory };
}

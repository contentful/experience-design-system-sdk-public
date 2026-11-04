import { createHash } from 'node:crypto';
import { chmodSync, closeSync, openSync, writeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildComponentEvidence,
  countComponentObservations,
} from '../../agents/prompts/helpers/build-component-evidence.js';
import type { RawComponentDefinition } from '../../steps/extraction/src/types/component.js';
import type {
  EvidenceManifest,
  EvidenceRecord,
  EvidenceValue,
  IndexedEvidenceRequest,
  IndexedEvidenceResult,
} from './types.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const pointer = (...parts: Array<string | number>): string =>
  '/' + parts.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/');

/** Write a lossless content-addressed tree; only saved evidence is indexed, never live project files. */
export function writeIndexedEvidence(request: IndexedEvidenceRequest): IndexedEvidenceResult {
  const input = { ...request.input };
  if (request.rawComponentsInline !== undefined || request.rawComponents !== undefined) {
    const raw: unknown = request.rawComponents ?? JSON.parse(request.rawComponentsInline!);
    if (!Array.isArray(raw)) throw new Error('Exploration components must be an array');
    for (const component of raw) {
      if (!record(component) || typeof component.name !== 'string' || typeof component.source !== 'string')
        throw new Error('Assigned exploration component/source identity missing');
      const componentId = component.component_id ?? component.componentId;
      if (componentId !== undefined && typeof componentId !== 'string')
        throw new Error('Assigned component identity invalid');
    }
    const evidence = buildComponentEvidence(raw as RawComponentDefinition[], 'caller-provided');
    input.components = request.candidateFree
      ? raw.map(
          ({
            name,
            source,
            component_id,
            sourcePath,
            framework,
          }: RawComponentDefinition & { component_id?: string }) => ({
            name,
            source,
            component_id,
            sourcePath,
            framework,
          }),
        )
      : raw;
    if (request.candidateFree) {
      input.omittedComponentFacts = countComponentObservations(evidence);
      const sourceKey = record(input.sourceInput) ? 'sourceInput' : 'sharedSource';
      if (record(input[sourceKey])) {
        const source = input[sourceKey];
        const observations = record(source.observations) ? source.observations : {};
        input[sourceKey] = {
          ...source,
          observations: { accepted: [], rejected: [] },
          omittedObservations:
            Number(source.omittedObservations ?? 0) +
            Number(input.omittedComponentFacts) +
            (Array.isArray(observations.accepted) ? observations.accepted.length : 0) +
            (Array.isArray(observations.rejected) ? observations.rejected.length : 0) +
            (observations.callerCoverage ? 1 : 0),
        };
      }
    } else input.componentEvidence = evidence;
  }
  const manifest: EvidenceManifest = { version: 1, root: null, records: Object.create(null) };
  const fd = openSync(join(request.directory, 'records.jsonl'), 'wx', 0o600);
  let bytes = 0;
  const store = (entry: EvidenceRecord): EvidenceValue => {
    const json = JSON.stringify(entry);
    const id = hash(json);
    if (!manifest.records[id]) {
      const buffer = Buffer.from(json + '\n');
      let written = 0;
      while (written < buffer.length) written += writeSync(fd, buffer, written, buffer.length - written);
      manifest.records[id] = {
        offset: bytes,
        bytes: buffer.length - 1,
        kind: entry.kind,
        count: Object.keys(entry.entries).length,
      };
      bytes += buffer.length;
    }
    return { ref: id };
  };
  const encode = (value: unknown): EvidenceValue => {
    if (Array.isArray(value)) return store({ kind: 'array', entries: value.map(encode) });
    if (record(value))
      return store({
        kind: 'object',
        entries: Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .map(([key, item]) => [key, encode(item)]),
        ),
      });
    if (typeof value === 'string' && value.length > 8192) {
      const chunks: string[] = [];
      for (let start = 0; start < value.length; start += 8192) chunks.push(value.slice(start, start + 8192));
      return store({ kind: 'text', entries: chunks });
    }
    return value as null | boolean | number | string;
  };
  try {
    manifest.root = encode(input);
  } finally {
    closeSync(fd);
  }
  chmodSync(join(request.directory, 'records.jsonl'), 0o400);
  writeFileSync(join(request.directory, 'manifest.json'), JSON.stringify(manifest), { mode: 0o400 });

  // Normalize only ephemeral source identity/timing; every original byte, coverage and diagnostic stays in the fingerprint.
  const transient = new Set([
    'captureId',
    'captureDigest',
    'envelopeId',
    'envelopeDigest',
    'sessionId',
    'extractionStepId',
  ]);
  const scalarHashes = new Map<string, string>();
  const normalized = (value: unknown, path: string[] = []): string => {
    if (Array.isArray(value))
      return hash(JSON.stringify(value.map((item, i) => normalized(item, [...path, String(i)]))));
    const source =
      (['sourceInput', 'sharedSource', 'source'].includes(path[0] ?? '') && path.length === 1) ||
      (path.length === 5 &&
        path[3] === 'sourceClosure' &&
        path[4] === 'captureBinding' &&
        ((path[0] === 'components' && path[2] === 'componentFacts') ||
          (path[0] === 'componentEvidence' && path[2] === 'facts')));
    const timing =
      path.length === 4 &&
      ['sourceInput', 'sharedSource', 'source'].includes(path[0] ?? '') &&
      path.slice(-3).join('.') === 'inventory.bounds.used';
    if (record(value))
      return hash(
        JSON.stringify(
          Object.entries(value)
            .filter(
              ([key, item]) =>
                item !== undefined && !(source && transient.has(key)) && !(timing && key === 'discoveryMs'),
            )
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, normalized(item, [...path, key])]),
        ),
      );
    if (typeof value === 'string' && path.length === 1 && path[0] === 'rendererReference') {
      try {
        const reference: unknown = JSON.parse(value);
        if (record(reference) && typeof reference.digest === 'string' && typeof reference.text === 'string') {
          const { retrievedAt: _time, ...content } = reference;
          return normalized(content);
        }
      } catch {
        /* Ordinary text is hashed exactly. */
      }
    }
    const scalar = JSON.stringify(value ?? null);
    let digest = scalarHashes.get(scalar);
    if (!digest) {
      digest = hash(scalar);
      scalarHashes.set(scalar, digest);
    }
    return digest;
  };
  const sourceKey = record(input.sourceInput) ? 'sourceInput' : record(input.source) ? 'source' : 'sharedSource';
  const source = record(input[sourceKey]) ? input[sourceKey] : undefined;
  const files = source && Array.isArray(source.files) ? (source.files as Array<Record<string, unknown>>) : [];
  const components = Array.isArray(input.components) ? (input.components as Array<Record<string, unknown>>) : [];
  const index = {
    format: 'indexed-immutable-evidence-v1',
    storage: { bytes, recordCount: Object.keys(manifest.records).length },
    root: '',
    sections: Object.keys(input)
      .filter((key) => input[key] !== undefined)
      .map((key) => ({ key, pointer: pointer(key), count: Array.isArray(input[key]) ? input[key].length : undefined })),
    source: source
      ? {
          pointer: pointer(sourceKey),
          coverage: source.coverage,
          promptCoverage: source.promptCoverage,
          omittedFiles: source.omittedFiles,
          omittedObservations: source.omittedObservations,
          extractionByteBinding: source.extractionByteBinding,
          diagnostics: pointer(sourceKey, 'diagnostics'),
        }
      : { status: 'unavailable' },
    components: components.map((component, i) => {
      const componentId = component.component_id ?? component.componentId;
      const definitions = files.flatMap((file, j) => {
        const refs = Array.isArray(file.componentRefs) ? (file.componentRefs as Array<Record<string, unknown>>) : [];
        const matches = refs.some(
          (ref) => ref.componentId === componentId && Array.isArray(ref.roles) && ref.roles.includes('definition'),
        );
        return matches ||
          [file.path, file.canonicalPath].some((path) => path === component.source || path === component.sourcePath)
          ? [
              {
                fileId: file.fileId,
                path: file.path ?? file.canonicalPath,
                pointer: pointer(sourceKey, 'files', j),
                coverage: file.coverage,
                partial: file.partial,
              },
            ]
          : [];
      });
      return {
        name: component.name,
        source: component.source,
        componentId,
        pointer: pointer('components', i),
        inputCount: Array.isArray(component.sourceCandidates) ? component.sourceCandidates.length : undefined,
        propCount: Array.isArray(component.props) ? component.props.length : undefined,
        slotCount: Array.isArray(component.slots) ? component.slots.length : undefined,
        definitions,
        definitionStatus: definitions.length ? 'indexed' : 'not-captured',
        evidence: request.candidateFree ? undefined : pointer('componentEvidence', i),
      };
    }),
    files: files.map((file, i) => ({
      fileId: file.fileId,
      path: file.path ?? file.canonicalPath,
      pointer: pointer(sourceKey, 'files', i),
      coverage: file.coverage,
      partial: file.partial,
    })),
  };
  return { digest: normalized(input), recordCount: Object.keys(manifest.records).length, bytes, index };
}

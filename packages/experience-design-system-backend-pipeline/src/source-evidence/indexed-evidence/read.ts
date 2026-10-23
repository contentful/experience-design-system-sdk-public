import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareAnalysisRepresentationCandidates } from '@contentful/experience-design-system-types';
import { sourcePropertyModel } from '../../steps/generation/src/services/property/source-property-model.js';
import type { RawComponentDefinition } from '../../steps/extraction/src/types/component.js';
import type { EvidenceManifest, EvidenceRecord, EvidenceValue } from './types.js';

/** Random-access reader over immutable encoded records; it never follows source paths onto disk. */
export class IndexedEvidenceReader {
  private readonly manifest: EvidenceManifest;
  private readonly fd: number;
  constructor(directory: string) {
    this.manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as EvidenceManifest;
    if (this.manifest.version !== 1) throw new Error('Unsupported evidence index');
    this.fd = openSync(join(directory, 'records.jsonl'), 'r');
  }
  close(): void {
    closeSync(this.fd);
  }
  private record(value: EvidenceValue): EvidenceRecord {
    if (value === null || typeof value !== 'object') throw new Error('Expected an indexed record');
    const location = this.manifest.records[value.ref];
    if (!location) throw new Error('Unknown evidence record');
    const buffer = Buffer.alloc(location.bytes);
    let read = 0;
    while (read < buffer.length) {
      const count = readSync(this.fd, buffer, read, buffer.length - read, location.offset + read);
      if (!count) throw new Error('Incomplete evidence record');
      read += count;
    }
    if (createHash('sha256').update(buffer).digest('hex') !== value.ref) throw new Error('Changed evidence record');
    return JSON.parse(buffer.toString('utf8')) as EvidenceRecord;
  }
  private value(pointer: string): EvidenceValue {
    if (/^@[a-f0-9]{64}$/.test(pointer)) return { ref: pointer.slice(1) };
    if (pointer !== '' && !pointer.startsWith('/')) throw new Error('Use a JSON Pointer or @recordId');
    let value = this.manifest.root;
    for (const encoded of pointer
      .slice(1)
      .split('/')
      .filter(() => pointer !== '')) {
      const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
      const entry = this.record(value);
      if (entry.kind === 'text' || !Object.hasOwn(entry.entries, key))
        throw new Error(`Evidence key not found: ${key}`);
      value = (entry.entries as Record<string, EvidenceValue>)[key]!;
    }
    return value;
  }
  private expand(value: EvidenceValue, depth: number): unknown {
    if (value === null || typeof value !== 'object') return value;
    const entry = this.record(value);
    if (depth === 0)
      return { evidenceId: `@${value.ref}`, kind: entry.kind, count: Object.keys(entry.entries).length, unread: true };
    if (entry.kind === 'text') return entry.entries.join('');
    if (entry.kind === 'array') return entry.entries.map((item) => this.expand(item, depth - 1));
    return Object.fromEntries(Object.entries(entry.entries).map(([key, item]) => [key, this.expand(item, depth - 1)]));
  }
  read(pointer: string, depth = 1): unknown {
    return this.expand(this.value(pointer), depth);
  }
  exact(pointer: string): unknown {
    return this.read(pointer, Infinity);
  }
  list(pointer: string, offset = 0, limit = 20): unknown {
    const entry = this.record(this.value(pointer));
    const entries = Object.entries(entry.entries);
    const page = entries.slice(offset, offset + limit);
    return {
      pointer,
      kind: entry.kind,
      total: entries.length,
      offset,
      nextOffset: offset + page.length < entries.length ? offset + page.length : null,
      complete: offset === 0 && page.length === entries.length,
      entries: page.map(([key, value]) => ({ key, value: this.expand(value, entry.kind === 'text' ? Infinity : 1) })),
    };
  }
  inputs(pointer: string, offset = 0, limit = 20): unknown {
    const candidates = this.record(this.value(`${pointer}/sourceCandidates`));
    if (candidates.kind !== 'array') throw new Error('Source candidates must be an array');
    const selected = candidates.entries.slice(offset, offset + limit);
    return {
      total: candidates.entries.length,
      offset,
      nextOffset: offset + selected.length < candidates.entries.length ? offset + selected.length : null,
      inputs: selected.map((value, i) => {
        const candidatePointer = `${pointer}/sourceCandidates/${offset + i}`;
        const entry = this.record(value);
        if (entry.kind !== 'object') throw new Error('Invalid source input');
        const facts = entry.entries.facts;
        const fact = facts && typeof facts === 'object' ? this.record(facts) : undefined;
        const fields = fact?.kind === 'object' ? fact.entries : {};
        const graph =
          fields.sourceGraph && typeof fields.sourceGraph === 'object' ? this.record(fields.sourceGraph) : undefined;
        const graphFields = graph?.kind === 'object' ? graph.entries : {};
        const nodes =
          graphFields.nodes && typeof graphFields.nodes === 'object' ? this.record(graphFields.nodes) : undefined;
        const root =
          nodes?.kind === 'array'
            ? nodes.entries.find((value) => {
                const node = this.record(value);
                return node.kind === 'object' && node.entries.id === graphFields.rootId;
              })
            : undefined;
        const summary = (value: EvidenceValue): unknown =>
          this.expand(
            value,
            value && typeof value === 'object' && this.manifest.records[value.ref]?.kind === 'text' ? 0 : 1,
          );
        return {
          pointer: candidatePointer,
          ...Object.fromEntries(
            ['name', 'keyPath', 'type', 'declaredRequired', 'sourceDefault', 'projection']
              .filter((key) => Object.hasOwn(entry.entries, key))
              .map((key) => [key, summary(entry.entries[key]!)]),
          ),
          facts: Object.fromEntries(
            [
              'origin',
              'certainty',
              'ambiguityReason',
              'sourceTypeText',
              'declaredRequired',
              'sourceDefault',
              'domain',
              'shapeNotes',
              'declarations',
            ]
              .filter((key) => Object.hasOwn(fields, key))
              .map((key) => [key, summary(fields[key]!)]),
          ),
          graph: Object.fromEntries(
            ['rootId', 'coverage', 'gaps', 'omittedNodes']
              .filter((key) => Object.hasOwn(graphFields, key))
              .map((key) => [key, this.expand(graphFields[key]!, 1)]),
          ),
          rootNode: root ? this.expand(root, 2) : { status: 'unavailable' },
        };
      }),
    };
  }
  source(pointer: string, start: number, end: number): unknown {
    const file = this.exact(pointer) as {
      fileId?: string;
      path?: string;
      coverage?: string;
      partial?: boolean;
      content?: string;
      ranges?: Array<{ startLine: number; endLine: number; displayStartLine?: number; text?: string }>;
    };
    const ranges = (file.ranges ?? []).map((range) => ({
      ...range,
      text:
        range.text ??
        (file.content ?? '')
          .split('\n')
          .slice(
            (range.displayStartLine ?? 1) - 1,
            (range.displayStartLine ?? 1) - 1 + range.endLine - range.startLine + 1,
          )
          .join('\n'),
    }));
    const covered = ranges.flatMap((range) => {
      const from = Math.max(start, range.startLine),
        to = Math.min(end, range.endLine);
      return from <= to
        ? [
            {
              startLine: from,
              endLine: to,
              text: range.text
                .split('\n')
                .slice(from - range.startLine, to - range.startLine + 1)
                .join('\n'),
            },
          ]
        : [];
    });
    const gaps: Array<{ startLine: number; endLine: number }> = [];
    let next = start;
    for (const range of [...covered].sort((a, b) => a.startLine - b.startLine)) {
      if (range.startLine > next) gaps.push({ startLine: next, endLine: range.startLine - 1 });
      next = Math.max(next, range.endLine + 1);
    }
    if (next <= end) gaps.push({ startLine: next, endLine: end });
    return {
      fileId: file.fileId,
      path: file.path,
      coverage: file.coverage,
      partial: file.partial,
      requested: { start, end },
      ranges: covered,
      gaps,
      complete: gaps.length === 0,
    };
  }
  candidates(pointer: string, name: string): unknown {
    const component = this.read(pointer, 1) as RawComponentDefinition & { component_id?: string; componentId?: string };
    const all = this.record(this.value(`${pointer}/sourceCandidates`));
    if (all.kind !== 'array') throw new Error('Source candidates must be an array');
    const matches = all.entries.filter((value) => {
      const candidate = this.record(value);
      return candidate.kind === 'object' && candidate.entries.name === name;
    });
    if (matches.length !== 1) throw new Error('Expected one exact source input');
    component.sourceCandidates = [
      this.expand(matches[0]!, Infinity) as NonNullable<RawComponentDefinition['sourceCandidates']>[number],
    ];
    const value = this.record(this.value(pointer));
    if (value.kind === 'object' && value.entries.componentFacts)
      component.componentFacts = this.exact(`${pointer}/componentFacts`) as RawComponentDefinition['componentFacts'];
    const model = sourcePropertyModel(
      component,
      name,
      component.component_id ?? component.componentId ?? component.name,
    );
    if (!model) throw new Error('Source graph unavailable for this input');
    return prepareAnalysisRepresentationCandidates(model);
  }
}

function integer(value: string | undefined, fallback?: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (parsed === undefined || !Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('Expected nonnegative integer');
  return parsed;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let reader: IndexedEvidenceReader | undefined;
  try {
    const [directory, operation, pointer = '', first, second] = process.argv.slice(2);
    if (!directory) throw new Error('Missing immutable evidence directory');
    reader = new IndexedEvidenceReader(directory);
    let result: unknown;
    switch (operation) {
      case 'read':
        result = reader.read(pointer, integer(first, 1));
        break;
      case 'exact':
        result = reader.exact(pointer);
        break;
      case 'list':
      case 'inputs': {
        const limit = integer(second, 20);
        if (!limit) throw new Error('Page size must be positive');
        result =
          operation === 'list'
            ? reader.list(pointer, integer(first, 0), limit)
            : reader.inputs(pointer, integer(first, 0), limit);
        break;
      }
      case 'source': {
        const start = integer(first),
          end = integer(second);
        if (!start || end < start) throw new Error('Expected an inclusive positive source line range');
        result = reader.source(pointer, start, end);
        break;
      }
      case 'candidates':
        if (!first) throw new Error('Missing exact source input name');
        result = reader.candidates(pointer, first);
        break;
      default:
        throw new Error('Expected read, exact, list, inputs, source or candidates');
    }
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
    process.exitCode = 1;
  } finally {
    reader?.close();
  }
}

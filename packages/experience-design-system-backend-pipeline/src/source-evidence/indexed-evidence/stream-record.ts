import type { SourceAccessProfile } from '../../profiling/source-access-profile.js';
import type { ImportWorkTiming } from '../../profiling/work-timing.js';
import { createHash } from 'node:crypto';
import { fstatSync, readSync } from 'node:fs';
import type { EvidenceRecordLocation, EvidenceValue } from './types.js';

export const EVIDENCE_BUFFER_BYTES = 64 * 1024;
export const EVIDENCE_PAGE_BYTES = 1024 * 1024;
export interface EvidenceEntry {
  key: string;
  value: EvidenceValue;
}

export function* streamEvidenceEntries(
  fd: number,
  id: string,
  location: EvidenceRecordLocation,
  signal?: AbortSignal,
  timing?: ImportWorkTiming,
  access?: SourceAccessProfile,
): Generator<EvidenceEntry> {
  timing?.count('recordCount');
  const size = timing ? timing.measure('fileReadMs', () => fstatSync(fd).size) : fstatSync(fd).size;
  if (
    ![location.offset, location.bytes, location.count].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    location.offset + location.bytes > size
  )
    throw new Error('Incomplete evidence record');
  const setup = () => ({
    buffer: Buffer.allocUnsafe(Math.min(EVIDENCE_BUFFER_BYTES, location.bytes)),
    token: Buffer.allocUnsafe(Math.min(EVIDENCE_BUFFER_BYTES, location.bytes)),
    hash: createHash('sha256'),
  });
  const { buffer, token, hash } = timing ? timing.measure('recordSetupMs', setup) : setup();
  let loaded = 0,
    cursor = 0,
    length = 0;
  const byte = (): number => {
    if (cursor === length) {
      signal?.throwIfAborted();
      if (loaded === location.bytes) return -1;
      const read = () =>
        readSync(fd, buffer, 0, Math.min(buffer.length, location.bytes - loaded), location.offset + loaded);
      length = timing ? timing.measure('fileReadMs', read) : read();
      timing?.count('readCalls');
      timing?.count('readBytes', length);
      if (access) {
        const note = () => access.recordRead(id, length);
        if (timing) timing.measure('accessMetricsMs', note);
        else note();
      }
      if (!length) throw new Error('Incomplete evidence record');
      if (timing) timing.measure('recordHashMs', () => hash.update(buffer.subarray(0, length)));
      else hash.update(buffer.subarray(0, length));
      loaded += length;
      cursor = 0;
    }
    return buffer[cursor++]!;
  };
  const literal = (text: string): void => {
    for (const character of text) if (byte() !== character.charCodeAt(0)) throw new Error('Changed evidence record');
  };
  literal(`{"kind":"${location.kind}","entries":${location.kind === 'object' ? '{' : '['}`);
  const closing = location.kind === 'object' ? 125 : 93;
  let current = byte(),
    count = 0;
  while (current !== closing) {
    if (current < 0) throw new Error('Incomplete evidence record');
    let key = String(count);
    if (location.kind === 'object') {
      let used = 0,
        escaped = false,
        inString = false;
      const scanKey = () => {
        while (true) {
          if (current === 58 && !inString) break;
          if (current < 0) throw new Error('Changed evidence record');
          if (used === token.length) throw new Error('Evidence entry exceeds bounded token size');
          token[used++] = current;
          if (escaped) escaped = false;
          else if (current === 92 && inString) escaped = true;
          else if (current === 34) inString = !inString;
          current = byte();
        }
      };
      if (timing) timing.measure('tokenScanMs', scanKey);
      else scanKey();
      const decodeKey = () => JSON.parse(token.toString('utf8', 0, used)) as string;
      key = timing ? timing.measure('recordDecodeMs', decodeKey) : decodeKey();
      if (typeof key !== 'string') throw new Error('Invalid evidence entry key');
      current = byte();
    }
    let used = 0,
      depth = 0,
      escaped = false,
      inString = false;
    const scanValue = () => {
      while (true) {
        if (!inString && depth === 0 && (current === 44 || current === closing)) break;
        if (current < 0) throw new Error('Changed evidence record');
        if (used === token.length) throw new Error('Evidence entry exceeds bounded token size');
        token[used++] = current;
        if (escaped) escaped = false;
        else if (current === 92 && inString) escaped = true;
        else if (current === 34) inString = !inString;
        else if (!inString && (current === 123 || current === 91)) depth++;
        else if (!inString && (current === 125 || current === 93)) depth--;
        current = byte();
      }
    };
    if (timing) timing.measure('tokenScanMs', scanValue);
    else scanValue();
    const decodeValue = () => JSON.parse(token.toString('utf8', 0, used)) as unknown;
    const value = timing ? timing.measure('recordDecodeMs', decodeValue) : decodeValue();
    timing?.count('parsedEntries');
    const validate = () => {
      if (
        value !== null &&
        typeof value === 'object' &&
        (Array.isArray(value) ||
          Object.keys(value).length !== 1 ||
          !('ref' in value) ||
          typeof value.ref !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.ref))
      )
        throw new Error('Invalid encoded evidence value');
      if (location.kind === 'text' && typeof value !== 'string') throw new Error('Invalid encoded text chunk');
    };
    if (timing) timing.measure('recordValidationMs', validate);
    else validate();
    count++;
    yield { key, value: value as EvidenceValue };
    if (current === 44) current = byte();
    else break;
  }
  if (current !== closing) throw new Error('Changed evidence record');
  literal('}');
  const digest = () => hash.digest('hex');
  if (byte() !== -1 || (timing ? timing.measure('recordHashMs', digest) : digest()) !== id)
    throw new Error('Changed evidence record');
}

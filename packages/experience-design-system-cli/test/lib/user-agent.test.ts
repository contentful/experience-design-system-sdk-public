import { describe, it, expect } from 'vitest';
import { buildUserAgent } from '../../src/lib/user-agent.js';

describe('buildUserAgent', () => {
  it('starts with the DSI CLI app segment carrying the package version', () => {
    const ua = buildUserAgent('2.13.0');
    expect(ua).toMatch(/^app contentful\.experience-design-system-cli\/2\.13\.0;/);
  });

  it('includes a node.js platform segment', () => {
    const ua = buildUserAgent('2.13.0');
    expect(ua).toContain('platform node.js/');
  });

  it('includes an os segment mapped from the current platform', () => {
    const ua = buildUserAgent('2.13.0');
    // os segment is present; value is one of the known CEP-0056 os names
    expect(ua).toMatch(/ os (macOS|Linux|Windows|Android)\//);
  });

  it('ends with a trailing semicolon (CEP-0056 format)', () => {
    expect(buildUserAgent('2.13.0').endsWith(';')).toBe(true);
  });

  it('carries no customer content — only the app/platform/os segments', () => {
    const ua = buildUserAgent('9.9.9');
    const segments = ua
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    // Every segment must be one of the three allowed kinds.
    for (const seg of segments) {
      expect(seg).toMatch(/^(app contentful\.experience-design-system-cli\/|platform |os )/);
    }
  });
});

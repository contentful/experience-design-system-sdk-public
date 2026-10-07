import { describe, expect, it } from 'vitest';
import { toApiHost, toConfiguredHost } from '../../src/helpers/host-utils.js';

describe('toApiHost', () => {
  it('returns the default API host when host is undefined', () => {
    expect(toApiHost(undefined)).toBe('https://api.contentful.com');
  });

  it('returns the default API host when host is empty string', () => {
    expect(toApiHost('')).toBe('https://api.contentful.com');
  });

  it('returns the default API host when host is whitespace only', () => {
    expect(toApiHost('   ')).toBe('https://api.contentful.com');
  });

  it('prepends https:// when host has no scheme', () => {
    expect(toApiHost('api.contentful.com')).toBe('https://api.contentful.com');
  });

  it('preserves an existing https:// scheme', () => {
    expect(toApiHost('https://api.contentful.com')).toBe('https://api.contentful.com');
  });

  it('strips trailing slashes', () => {
    expect(toApiHost('api.contentful.com/')).toBe('https://api.contentful.com');
  });
});

describe('toConfiguredHost', () => {
  it('returns undefined when host is undefined', () => {
    expect(toConfiguredHost(undefined)).toBeUndefined();
  });

  it('returns undefined when host is empty', () => {
    expect(toConfiguredHost('')).toBeUndefined();
  });

  it('strips https:// prefix', () => {
    expect(toConfiguredHost('https://api.contentful.com')).toBe('api.contentful.com');
  });

  it('returns host unchanged when it has no scheme', () => {
    expect(toConfiguredHost('api.contentful.com')).toBe('api.contentful.com');
  });

  it('strips trailing slashes', () => {
    expect(toConfiguredHost('api.contentful.com/')).toBe('api.contentful.com');
  });
});

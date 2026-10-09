import { describe, expect, it } from 'vitest';
import { toApiHost, toConfiguredHost } from '@contentful/experience-design-system-backend-pipeline';
import {
  isUnchanged,
  keyAction,
  missingField,
  nextField,
  normalize,
} from '../../src/tui/import/steps/04-credentials/logic.js';

const noKey = { escape: false, tab: false, ctrl: false };

describe('keyAction', () => {
  it('maps Esc to back and Tab to the next field', () => {
    expect(keyAction('', { ...noKey, escape: true })).toBe('back');
    expect(keyAction('', { ...noKey, tab: true })).toBe('next-field');
  });

  it('skips only on Ctrl+S, so typing s never skips', () => {
    expect(keyAction('s', { ...noKey, ctrl: true })).toBe('skip');
    expect(keyAction('s', noKey)).toBeNull();
    expect(keyAction('q', noKey)).toBeNull();
  });
});

describe('nextField', () => {
  it('cycles through all four fields', () => {
    expect(nextField('spaceId')).toBe('environmentId');
    expect(nextField('environmentId')).toBe('cmaToken');
    expect(nextField('cmaToken')).toBe('host');
    expect(nextField('host')).toBe('spaceId');
  });
});

describe('hosts', () => {
  it('stores hosts without scheme or trailing slash, undefined when empty', () => {
    expect(toConfiguredHost('https://api.eu.contentful.com/')).toBe('api.eu.contentful.com');
    expect(toConfiguredHost('  ')).toBeUndefined();
    expect(toConfiguredHost(undefined)).toBeUndefined();
  });

  it('builds an API url, keeping an explicit scheme', () => {
    expect(toApiHost('api.eu.contentful.com')).toBe('https://api.eu.contentful.com');
    expect(toApiHost('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(toApiHost('')).toBe('https://api.contentful.com');
  });
});

describe('normalize, missingField, isUnchanged', () => {
  const values = { spaceId: ' s1 ', environmentId: ' master ', cmaToken: ' tok ', host: '' };

  it('trims values and defaults the host', () => {
    expect(normalize(values)).toEqual({
      spaceId: 's1',
      environmentId: 'master',
      cmaToken: 'tok',
      host: 'api.contentful.com',
    });
  });

  it('flags a missing space, environment or token but not a missing host', () => {
    expect(missingField(normalize(values))).toBe(false);
    expect(missingField(normalize({ ...values, spaceId: '' }))).toBe(true);
    expect(missingField(normalize({ ...values, environmentId: ' ' }))).toBe(true);
    expect(missingField(normalize({ ...values, cmaToken: '' }))).toBe(true);
  });

  it('detects whether anything changed from the initial values', () => {
    const initial = normalize(values);
    expect(isUnchanged(normalize(values), initial)).toBe(true);
    expect(isUnchanged({ ...initial, host: 'api.eu.contentful.com' }, initial)).toBe(false);
  });
});

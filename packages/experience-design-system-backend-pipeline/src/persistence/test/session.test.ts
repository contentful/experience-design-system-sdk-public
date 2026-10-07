import { describe, expect, it } from 'vitest';
import { openSession } from '../session/index.js';

describe('openSession', () => {
  it('returns a SessionHandle with the provided sessionId', () => {
    const session = openSession({ dbPath: ':memory:', sessionId: 'test-id-0000', cliVersion: 'v1' });
    expect(session.id).toBe('test-id-0000');
    session.close();
  });

  it('generates a sessionId when none is provided', () => {
    const session = openSession({ dbPath: ':memory:', cliVersion: 'v1' });
    expect(session.id).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
    session.close();
  });

  it('returns null for a composition cache miss', () => {
    const session = openSession({ dbPath: ':memory:', cliVersion: 'v1' });
    expect(session.composition.lookup('missing-hash')).toBeNull();
    session.close();
  });

  it('stores and retrieves a composition cache entry', () => {
    const session = openSession({ dbPath: ':memory:', cliVersion: 'v1' });
    session.composition.store('hash-abc', 'agent output text');
    expect(session.composition.lookup('hash-abc')).toBe('agent output text');
    session.close();
  });

  it('isolates composition cache by cliVersion', () => {
    const s1 = openSession({ dbPath: ':memory:', cliVersion: 'v1' });
    s1.composition.store('hash-abc', 'v1-output');
    s1.close();

    const s2 = openSession({ dbPath: ':memory:', cliVersion: 'v2' });
    expect(s2.composition.lookup('hash-abc')).toBeNull();
    s2.close();
  });

  it('stores and retrieves a selection cache entry', () => {
    const session = openSession({ dbPath: ':memory:', cliVersion: 'v1' });
    session.selection.store('comp-hash', 'prompt-hash', 'accepted', 'looks good');
    const result = session.selection.lookup('comp-hash', 'prompt-hash');
    expect(result).toEqual({ decision: 'accepted', reason: 'looks good' });
    session.close();
  });

  it('stores and retrieves a selection cache entry with null reason', () => {
    const session = openSession({ dbPath: ':memory:', cliVersion: 'v1' });
    session.selection.store('comp-hash', 'prompt-hash', 'rejected', null);
    const result = session.selection.lookup('comp-hash', 'prompt-hash');
    expect(result).toEqual({ decision: 'rejected', reason: null });
    session.close();
  });

  it('returns null for a generation cache miss', () => {
    const session = openSession({ dbPath: ':memory:', cliVersion: 'v1' });
    expect(session.generation.lookup('input-hash', 'prompt-hash')).toBeNull();
    session.close();
  });

  it('stores and retrieves a generation cache entry', () => {
    const session = openSession({ dbPath: ':memory:', cliVersion: 'v1' });
    const entry = { componentId: 'Button', fields: {} } as never;
    session.generation.store('input-hash', 'prompt-hash', entry);
    expect(session.generation.lookup('input-hash', 'prompt-hash')).toEqual(entry);
    session.close();
  });

  it('supports two separate sessions in the same db without interference', () => {
    const s1 = openSession({ dbPath: ':memory:', sessionId: 'session-one-0001', cliVersion: 'v1' });
    const s2 = openSession({ dbPath: ':memory:', sessionId: 'session-two-0002', cliVersion: 'v1' });
    s1.composition.store('hash-1', 'output-1');
    expect(s2.composition.lookup('hash-1')).toBeNull();
    s1.close();
    s2.close();
  });
});

import { describe, expect, it } from 'vitest';
import { parseToolCalls } from '../src/agents/parsers/parse-tool-calls.js';
import {
  openPipelineDb,
  getOrCreateSession,
  storeCDFComponents,
  storeRawComponents,
  loadCDFComponents,
  loadRawComponents,
  applyToolCalls,
  loadPropertyDecisions,
} from '../src/persistence/src/session/repositories/db.js';

const definition = JSON.parse(
  '{"$type":"array","$category":"content","$required":false,"$items":{"$type":"record","$required":true,"$fields":{"__proto__":{"$type":"boolean","$required":false},"a.b/λ":{"$type":"number","$required":true}}},"$default":[{"__proto__":false,"a.b/λ":0}]}',
);

describe('native property consumer transport', () => {
  it('parses complete recursive metadata and own typed defaults', () => {
    const parsed = parseToolCalls(
      JSON.stringify({
        tool: 'classify_prop',
        prop: 'rows',
        cdf_type: 'array',
        cdf_category: 'content',
        items: definition.$items,
        default: definition.$default,
        required: false,
      }),
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.calls[0]).toMatchObject({ items: definition.$items, default: definition.$default, required: false });
  });
  it('preserves recursive definition through unrelated review save and rejects invalid writes atomically', () => {
    const db = openPipelineDb(':memory:');
    try {
      const session = getOrCreateSession(db, 'new', 'example', { command: 'analyze extract' });
      storeRawComponents(db, session.sessionId, [
        {
          name: 'Example',
          source: '/example.tsx',
          framework: 'react',
          props: [{ name: 'rows', type: 'Array<Row>', required: false }],
          slots: [],
        },
      ]);
      const entry = { $type: 'component' as const, $properties: { rows: definition } };
      storeCDFComponents(db, session.sessionId, [{ key: 'Example', entry }]);
      expect(loadCDFComponents(db, session.sessionId)[0]?.entry.$properties.rows).toEqual(definition);
      storeCDFComponents(db, session.sessionId, [
        { key: 'Example', entry: { ...entry, $description: 'Edited description' } },
      ]);
      expect(loadCDFComponents(db, session.sessionId)[0]?.entry.$properties.rows).toEqual(definition);
      expect(() =>
        storeCDFComponents(db, session.sessionId, [
          { key: 'Example', entry: { ...entry, $properties: { rows: { ...definition, $default: ['invalid'] } } } },
        ]),
      ).toThrow();
      expect(loadCDFComponents(db, session.sessionId)[0]?.entry.$properties.rows).toEqual(definition);
    } finally {
      db.close();
    }
  });
});

it('rejects fabricated representation fields while retaining the raw source and prior decision', () => {
  const db = openPipelineDb(':memory:');
  try {
    const { sessionId } = getOrCreateSession(db, 'new', 'example', { command: 'analyze extract' });
    storeRawComponents(db, sessionId, [
      {
        name: 'Example',
        source: '/example.tsx',
        framework: 'react',
        props: [{ name: 'first', type: 'string', required: false }],
        slots: [],
      },
    ]);
    storeCDFComponents(db, sessionId, [
      {
        key: 'Example',
        entry: { $type: 'component', $properties: { first: { $type: 'string', $category: 'content', $default: '' } } },
      },
    ]);
    const before = loadCDFComponents(db, sessionId);
    expect(() =>
      storeCDFComponents(db, sessionId, [
        {
          key: 'Example',
          entry: { $type: 'component', $properties: { second: { $type: 'number', $category: 'state', $default: 0 } } },
        },
      ]),
    ).toThrow('exact retained');
    expect(loadCDFComponents(db, sessionId)).toEqual(before);
    expect(loadRawComponents(db, sessionId)[0]!.props[0]!.name).toBe('first');
  } finally {
    db.close();
  }
});

it('preserves exact native decisions during source refresh with preserved CDF', () => {
  const db = openPipelineDb(':memory:');
  try {
    const { sessionId } = getOrCreateSession(db, 'new', 'example', { command: 'analyze extract' });
    const raw = {
      name: 'Example',
      source: '/example.tsx',
      framework: 'react' as const,
      props: [{ name: 'rows', type: 'Array<Row>', required: false }],
      slots: [],
    };
    storeRawComponents(db, sessionId, [raw]);
    storeCDFComponents(db, sessionId, [
      { key: 'Example', entry: { $type: 'component', $properties: { rows: definition } } },
    ]);
    storeRawComponents(db, sessionId, [raw], { preserveCDF: true, preserveStatus: true });
    expect(loadCDFComponents(db, sessionId)[0]!.entry.$properties.rows).toEqual(definition);
  } finally {
    db.close();
  }
});

it('keeps token source resolution separate from explicit generation and review default intent', () => {
  const db = openPipelineDb(':memory:');
  try {
    const { sessionId } = getOrCreateSession(db, 'new', 'example', { command: 'analyze extract' });
    storeRawComponents(db, sessionId, [
      {
        name: 'Example',
        source: '/example.tsx',
        framework: 'react',
        props: [{ name: 'color', type: 'string', required: false, defaultValue: 'blue' }],
        slots: [],
      },
    ]);
    db.prepare('INSERT INTO raw_tokens(session_id,path,type,value) VALUES(?,?,?,?)').run(
      sessionId,
      'colors.blue',
      'color',
      '"#0000ff"',
    );
    db.prepare('INSERT INTO raw_token_name_paths(session_id,raw_name,path,source) VALUES(?,?,?,?)').run(
      sessionId,
      'blue',
      'colors.blue',
      'automatic',
    );
    const component = loadRawComponents(db, sessionId)[0]!;
    const call = {
      tool: 'classify_prop' as const,
      prop: 'color',
      cdf_type: 'token',
      cdf_category: 'design' as const,
      token_kind: 'color',
    };
    const read = () => loadCDFComponents(db, sessionId)[0]!.entry;
    applyToolCalls(db, sessionId, component.component_id, 'Example', [{ tool: 'classify_component' }, call], []);
    expect(read().$properties.color!.$default).toBe('colors.blue');
    const originalDecision = loadPropertyDecisions(db, sessionId)[0]!;
    storeCDFComponents(db, sessionId, [{ key: 'Example', entry: read() }]);
    expect(loadPropertyDecisions(db, sessionId)[0]).toEqual(originalDecision);
    applyToolCalls(
      db,
      sessionId,
      component.component_id,
      'Example',
      [{ tool: 'classify_component' }, { ...call, default: 'colors.other' }],
      [],
    );
    expect(read().$properties.color!.$default).toBe('colors.other');
    applyToolCalls(
      db,
      sessionId,
      component.component_id,
      'Example',
      [{ tool: 'classify_component' }, { ...call, default_intent: { action: 'clear' } }],
      [],
    );
    expect(Object.hasOwn(read().$properties.color!, '$default')).toBe(false);
    const entry = read();
    entry.$properties.color!.$default = '';
    storeCDFComponents(db, sessionId, [{ key: 'Example', entry }]);
    expect(read().$properties.color!.$default).toBe('');
    delete entry.$properties.color!.$default;
    storeCDFComponents(db, sessionId, [{ key: 'Example', entry }]);
    expect(Object.hasOwn(read().$properties.color!, '$default')).toBe(false);
    expect(loadRawComponents(db, sessionId)[0]!.props[0]!.defaultValue).toBe('blue');
  } finally {
    db.close();
  }
});

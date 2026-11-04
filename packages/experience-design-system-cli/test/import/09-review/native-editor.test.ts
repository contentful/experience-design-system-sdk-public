import { expect, it } from 'vitest';
import { parseToState, serializeState } from '../../../src/tui/import/steps/09-review/components/FieldEditor.js';
const property = JSON.parse(
  '{"$type":"array","$category":"content","$required":false,"$items":{"$type":"record","$required":true,"$fields":{"__proto__":{"$type":"boolean","$required":false},"a.b/λ":{"$type":"number","$required":true}}},"$default":[{"__proto__":false,"a.b/λ":0}]}',
);
it('retains every recursive field and own default through unrelated editor changes', () => {
  const original = JSON.stringify({ $type: 'component', $properties: { rows: property } });
  const parsed = parseToState(original);
  expect(parsed.error).toBeNull();
  parsed.state.componentDescription = 'Changed';
  parsed.state.props[0]!.description = 'Rows';
  const edited = JSON.parse(serializeState(parsed.state, original));
  expect(edited.$properties.rows).toEqual({ ...property, $description: 'Rows' });
});
it('refuses unsupported definitions instead of coercing their type', () => {
  expect(
    parseToState(
      JSON.stringify({ $type: 'component', $properties: { data: { $type: 'unknown', $category: 'content' } } }),
    ).error,
  ).toBeTruthy();
});

it('preserves source ownership and slot metadata through unrelated complete editor changes', () => {
  const sourceInput = {
    schemaVersion: 1,
    componentId: 'surface',
    componentDeclarationId: 'declaration',
    rootSymbolId: 'parameter',
    inputName: 'supplied',
    inputPath: ['supplied'],
  };
  const slot = {
    $sourceInput: sourceInput,
    $allowedComponents: ['Example'],
    $required: true,
    $description: 'Original',
  };
  const original = JSON.stringify({ $type: 'component', $properties: {}, $slots: { region: slot } });
  const parsed = parseToState(original);
  expect(parsed.error).toBeNull();
  parsed.state.componentDescription = 'Edited';
  expect(JSON.parse(serializeState(parsed.state, original)).$slots.region).toEqual(slot);
});

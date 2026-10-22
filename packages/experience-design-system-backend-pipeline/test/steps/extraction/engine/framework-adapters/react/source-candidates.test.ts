import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractReactComponents } from '../../../../../../src/steps/extraction/src/framework-adapters/react/extractor.js';

const temporaryDirectories: string[] = [];

function fixture(files: Record<string, string>): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'source-candidates-'));
  temporaryDirectories.push(directory);
  return Object.entries(files).map(([name, content]) => {
    const path = join(directory, name);
    writeFileSync(path, content);
    return path;
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('React source candidates', () => {
  it('retains declared names excluded by the current prop projection and records exact metadata', async () => {
    const files = fixture({
      'Button.tsx': `
        type ButtonProps = {
          title: string;
          __scopeDemo: 'local' | 'global';
          _key: number;
          key: number;
          $key: false | true;
          'data.state/path': string | 'ready';
          '': string;
        };
        export function Button({ title, _key }: ButtonProps) {
          return <button id={String(_key)}>{title}</button>;
        }
      `,
    });

    const result = await extractReactComponents(files);
    const button = result.components.find((component) => component.name === 'Button')!;
    const candidates = button.sourceCandidates ?? [];

    expect(button.props.some((prop) => prop.name === '__scopeDemo')).toBe(false);
    expect(candidates.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining(['__scopeDemo', '_key', 'key', '$key', 'data.state/path', '']),
    );
    expect(candidates.find((candidate) => candidate.name === '__scopeDemo')?.projection.kind).toBe('excluded');
    expect(candidates.find((candidate) => candidate.name === 'data.state/path')?.keyPath).toEqual(['data.state/path']);
    expect(candidates.find((candidate) => candidate.name === '$key')?.facts?.domain).toMatchObject({
      observedLiterals: [
        { kind: 'boolean', value: 'false' },
        { kind: 'boolean', value: 'true' },
      ],
      openness: 'closed',
    });
    expect(candidates.find((candidate) => candidate.name === '$key')?.facts).toMatchObject({
      origin: 'own',
      sourceTypeText: 'false | true',
      declarations: [{ textHash: expect.any(String), binding: 'unverified', startLine: expect.any(Number) }],
    });
  });

  it('records implementation bindings beside useful declarations without changing projected props', async () => {
    const files = fixture({
      'Card.tsx': `
        type CardProps = { title: string };
        export function Card({ title, runtimeLabel }: CardProps) {
          return <button aria-label={runtimeLabel}>{title}</button>;
        }
      `,
    });

    const result = await extractReactComponents(files);
    const card = result.components.find((component) => component.name === 'Card')!;

    expect(card.props.map((prop) => prop.name)).toEqual(['title']);
    expect(card.sourceCandidates?.find((candidate) => candidate.name === 'runtimeLabel')).toMatchObject({
      evidenceKinds: ['binding'],
      projection: { kind: 'excluded' },
    });
  });

  it('keeps exact source defaults and declared requiredness separate from display defaults', async () => {
    const files = fixture({
      'Defaults.tsx': `
        type DefaultsProps = { requiredLabel: string; optionalCount?: number; disabled: boolean };
        export function Defaults({ requiredLabel = "source", optionalCount = 0, disabled = false }: DefaultsProps) {
          return <button disabled={disabled}>{requiredLabel}{optionalCount}</button>;
        }
      `,
    });

    const result = await extractReactComponents(files);
    const defaults = result.components.find((component) => component.name === 'Defaults')!;
    const required = defaults.sourceCandidates?.find((candidate) => candidate.name === 'requiredLabel');
    const optional = defaults.sourceCandidates?.find((candidate) => candidate.name === 'optionalCount');
    const disabled = defaults.sourceCandidates?.find((candidate) => candidate.name === 'disabled');

    expect(defaults.props.find((prop) => prop.name === 'requiredLabel')).toMatchObject({
      required: false,
      defaultValue: 'source',
    });
    expect(required?.facts).toMatchObject({
      declaredRequired: true,
      sourceDefault: { expression: '"source"' },
    });
    expect(optional?.facts).toMatchObject({
      declaredRequired: false,
      sourceDefault: { expression: '0' },
    });
    expect(disabled?.facts).toMatchObject({
      declaredRequired: true,
      sourceDefault: { expression: 'false' },
    });
  });
  it('distinguishes known required advisory omission from unavailable source shape', async () => {
    const files = fixture({
      'Summary.tsx': `type Props = { complete: { required: string; optional?: number }; loss: { required: () => void; optional?: string }; unavailable: unknown }; export function Summary(props: Props) { return <div/>; }`,
    });
    const candidates = (await extractReactComponents(files)).components[0]!.sourceCandidates!;
    expect(candidates.find((candidate) => candidate.name === 'complete')?.facts?.requiredFieldDropped).toBe(false);
    expect(candidates.find((candidate) => candidate.name === 'loss')?.facts).toMatchObject({
      requiredFieldDropped: true,
      advisoryShape: null,
    });
    expect(candidates.find((candidate) => candidate.name === 'unavailable')?.facts?.requiredFieldDropped).toBeNull();
  });
});

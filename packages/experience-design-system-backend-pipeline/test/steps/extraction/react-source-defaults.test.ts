import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractReactComponents } from '../../../src/steps/extraction/src/framework-adapters/react/extract-react-components.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('backend React source defaults', () => {
  it('preserves exact source expressions and declared requiredness beside display defaults', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'backend-source-defaults-'));
    temporaryDirectories.push(directory);
    const filePath = join(directory, 'Defaults.tsx');
    writeFileSync(
      filePath,
      `
        type DefaultsProps = { requiredLabel: string; optionalCount?: number; disabled: boolean };
        export function Defaults({ requiredLabel = "source", optionalCount = 0, disabled = false }: DefaultsProps) {
          return <button disabled={disabled}>{requiredLabel}{optionalCount}</button>;
        }
      `,
    );

    const result = await extractReactComponents([filePath]);
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
});

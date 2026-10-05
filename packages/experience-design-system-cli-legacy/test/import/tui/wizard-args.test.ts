import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildGenerateTokensArgs,
  buildGenerateComponentsArgs,
  buildSavedCDF,
  buildMapTokensArgs,
  shouldRunMapTokens,
} from '../../../src/import/tui/WizardApp.js';

const wizardAppPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/import/tui/WizardApp.tsx');

describe('wizard combined CDF output', () => {
  it('writes components and tokens into one schema-valid CDF document', () => {
    const cdf = buildSavedCDF(
      [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $description: 'A button',
            $properties: {},
          },
        },
      ],
      [{ path: 'colors.brand', $type: 'color', $value: '#09f' }],
    );

    expect(cdf.$schema).toBe('https://contentful.com/schemas/cdf');
    expect(cdf.Button).toMatchObject({ $type: 'component' });
    expect(cdf.colors).toMatchObject({ brand: { $type: 'color', $value: '#09f' } });
  });
});

describe('wizard generate-tokens args', () => {
  it('never passes a cache flag', () => {
    const args = buildGenerateTokensArgs({
      rawTokensPath: '/tmp/raw-tokens.scss',
      agent: 'claude',
    });
    expect(args).not.toContain('--no-cache');
  });

  it('forwards prompt overrides to token generation', () => {
    const args = buildGenerateTokensArgs({
      rawTokensPath: '/tmp/raw-tokens.scss',
      agent: 'claude',
      promptOverrides: ['tokens=./tokens.md'],
    });
    expect(args).toContain('--prompt');
    expect(args).toContain('tokens=./tokens.md');
  });
});

describe('wizard generate-components args', () => {
  it('passes --session and --agent', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 's',
      agent: 'claude',
    });
    expect(args).toContain('--session');
    expect(args).toContain('s');
    expect(args).toContain('--agent');
    expect(args).toContain('claude');
  });

  it('never passes cache flags', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 'abc-123',
      tokensPath: '/tmp/tokens.json',
      agent: 'claude',
    });
    for (const flag of ['--no-cache', '--cache-status', '--restore-cache', '--cached-components']) {
      expect(args).not.toContain(flag);
    }
  });

  it('starts generation for every accepted component without a cache lookup step', async () => {
    const source = await readFile(wizardAppPath, 'utf8');
    const scopeGateBlock = source.slice(source.indexOf('onAdvanceToGenerate'), source.indexOf('onAdvanceToPushFlow'));
    expect(scopeGateBlock).toContain('void runGenerate(sid, state.tokensPath, acceptedCount);');
    expect(scopeGateBlock).toContain("step: 'generating'");
    expect(source).not.toContain('--cache-status');
    expect(source).not.toContain('finishCachedGeneration');
    expect(source).not.toContain('checkGenerateCache');
  });
});

describe('wizard map-tokens step', () => {
  it('builds the map tokens command with the generated session and agent', () => {
    expect(
      buildMapTokensArgs({
        sessionId: 'generated-session',
        agent: 'claude',
        model: 'model-a',
      }),
    ).toEqual(['map', 'tokens', '--session', 'generated-session', '--agent', 'claude', '--model', 'model-a']);
  });

  it('can resolve defaults without invoking the agent', () => {
    expect(
      buildMapTokensArgs({
        sessionId: 'generated-session',
        agent: 'claude',
        skipAgent: true,
      }),
    ).toEqual(['map', 'tokens', '--session', 'generated-session', '--agent', 'claude', '--skip-agent']);
  });

  it('forwards prompt overrides to token mapping', () => {
    const args = buildMapTokensArgs({
      sessionId: 'generated-session',
      agent: 'claude',
      promptOverrides: ['map-tokens=./map.md'],
    });
    expect(args).toContain('--prompt');
    expect(args).toContain('map-tokens=./map.md');
  });

  it('requires both mappable props and raw tokens before invoking the agent', () => {
    expect(shouldRunMapTokens({ mappablePropCount: 1, rawTokenCount: 1 })).toBe(true);
    expect(shouldRunMapTokens({ mappablePropCount: 0, rawTokenCount: 1 })).toBe(false);
    expect(shouldRunMapTokens({ mappablePropCount: 1, rawTokenCount: 0 })).toBe(false);
  });
});

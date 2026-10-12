import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
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
    expect(cdf.colors).toMatchObject({
      brand: { $type: 'color', $value: '#09f' },
    });
  });
});

describe('wizard generate-components cache', () => {
  it('passes precomputed cached component names to generation', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 'abc-123',
      agent: 'claude',
      cachedComponents: ['Button', 'Card'],
    });
    expect(args).toContain('--cached-components');
    expect(args).toContain('["Button","Card"]');
  });

  it('defaults to cache-on (no --no-cache flag)', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 'abc-123',
      tokensPath: '/tmp/tokens.json',
      agent: 'claude',
    });
    expect(args).not.toContain('--no-cache');
  });

  it('does pass --session and --agent', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 's',
      agent: 'claude',
    });
    expect(args).toContain('--session');
    expect(args).toContain('s');
    expect(args).toContain('--agent');
    expect(args).toContain('claude');
  });

  it('passes --no-cache when noCache is true', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 'abc-123',
      tokensPath: '/tmp/tokens.json',
      agent: 'claude',
      noCache: true,
    });
    expect(args).toContain('--no-cache');
  });

  it('omits --no-cache when noCache is false or undefined (default)', () => {
    const explicit = buildGenerateComponentsArgs({
      sessionId: 's',
      agent: 'claude',
      noCache: false,
    });
    const omitted = buildGenerateComponentsArgs({
      sessionId: 's',
      agent: 'claude',
    });
    expect(explicit).not.toContain('--no-cache');
    expect(omitted).not.toContain('--no-cache');
  });

  it('does not render a dedicated cache-check or cache-restore screen', async () => {
    const source = await readFile(wizardAppPath, 'utf8');
    expect(source).not.toContain('generation-cache-check');
    expect(source).not.toContain('generationCacheHit');
    expect(source).not.toContain('Reusing cached definitions');
    expect(source).not.toContain('Checking cached definitions');
  });

  // These read the wizard's source, so they compare it with the whitespace squeezed out: formatting must not decide
  // whether a test passes.
  const squeeze = (text: string): string => text.replace(/\s+/g, '');

  it('does not enter the generation screen when cached definitions are restored', async () => {
    const source = squeeze(await readFile(wizardAppPath, 'utf8'));
    const scopeBlock = source.slice(source.indexOf('onAdvanceToGenerate'), source.indexOf('onAdvanceToPushFlow'));
    expect(scopeBlock).toContain(squeeze('void finishCachedGeneration(sid, acceptedCount);'));
    // a miss does enter the generating screen (a trailing comma is formatting, so it is not part of the check)
    expect(scopeBlock).toContain(squeeze("update({ step: 'generating', generateProgress: null, acceptedCount"));
    expect(scopeBlock).toContain(
      squeeze('void runGenerate(sid, state.tokensPath, acceptedCount, false, restoredCachedNames);'),
    );
    const cacheBranch = scopeBlock.slice(scopeBlock.indexOf('if(cacheHit)'), scopeBlock.indexOf('}else{'));
    expect(cacheBranch).not.toContain("step:'generating'");
    expect(source).not.toContain('GENERATION_SCREEN_DELAY_MS');
  });

  it('compares the accepted names against the cache check the CLI already finished, and does not start its own', async () => {
    const source = squeeze(await readFile(wizardAppPath, 'utf8'));
    // the CLI ran the check while the gate was open and restored the cache before starting the wizard
    expect(source).toContain(squeeze('const cachePromise = Promise.resolve(new Set(handedOffCachedNames));'));
    // so the wizard has no background check of its own any more
    expect(source).not.toContain("'generation-cache-preflight'");
    // a result that is not a full hit is checked again after the decisions are saved, as before
    expect(source).toContain(squeeze('cachedNames = await checkGenerateCacheComponents(sid, state.tokensPath, true);'));
  });
});

describe('wizard map-tokens step', () => {
  it('builds the map tokens command with the generated session and agent', () => {
    expect(
      buildMapTokensArgs({
        sessionId: 'generated-session',
        agent: 'claude',
        model: 'model-a',
        noCache: true,
      }),
    ).toEqual([
      'map',
      'tokens',
      '--session',
      'generated-session',
      '--agent',
      'claude',
      '--model',
      'model-a',
      '--no-cache',
    ]);
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

import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrompt } from '../src/prompt-builder.js';

const INLINE_COMPONENTS = JSON.stringify([
  {
    name: 'Button',
    source: 'src/Button.tsx',
    framework: 'react',
    props: [],
    slots: [],
  },
]);

describe('buildPrompt', () => {
  it('autonomous preamble includes do-not-pause instruction', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('AUTONOMOUS mode');
    expect(prompt).toContain('do not pause to ask for confirmation');
  });

  it('injects inline raw components JSON into the prompt', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('Raw component data (JSON)');
    expect(prompt).toContain('Button');
  });

  it('omits token sections when not provided', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).not.toContain('DTCG token data (for token kind lookups)');
    expect(prompt).not.toContain('Token-name sidecar (raw name');
  });

  it('inlines optional token data when provided', async () => {
    const tokensInline = JSON.stringify({ colors: { primary: { $type: 'color', $value: '#0066ff' } } });
    const tokenMapInline = JSON.stringify({ '--brand-primary': 'colors.primary' });
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      tokensInline,
      tokenMapInline,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('DTCG token data (for token kind lookups)');
    expect(prompt).toContain('colors.primary');
    expect(prompt).toContain('Token-name sidecar (raw name');
    expect(prompt).toContain('--brand-primary');
  });

  it('includes tool-call protocol instructions in autonomous mode', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('classify_prop');
    expect(prompt).toContain('exclude_prop');
    expect(prompt).toContain('classify_slot');
  });

  it('treats bare name as semantic component data, not a DOM pass-through', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });

    expect(prompt).toContain('`name` — content prop, usually `string`');
    expect(prompt).toContain('`options`, `value`, `name`, `form`');
    expect(prompt).not.toContain('`name` (the bare HTML form `name` attribute)');
  });

  it('lists "reason" as a required field on classify_prop with description orthogonality (Feature 1)', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    // The classify_prop example line should include both "description" and "reason".
    expect(prompt).toMatch(
      /classify_prop[^\n]*"description"[^\n]*"reason"|classify_prop[^\n]*"reason"[^\n]*"description"/,
    );
    // Reason is REQUIRED on classify_prop and is internal (not customer-facing).
    expect(prompt).toMatch(/"reason"\s+is\s+REQUIRED/i);
    expect(prompt).toMatch(/customer-facing/i);
  });

  it('preserves the "Description content rules (CRITICAL)" guardrail in skill prompt (Feature 1)', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    // The skill file content is inlined into the prompt; the CRITICAL block must remain.
    expect(prompt).toContain('Description content rules');
    expect(prompt).toContain('CRITICAL');
    expect(prompt).toContain('Never');
    expect(prompt).toContain('customer-facing');
  });

  it('includes skill file content', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    // Skill file contains these headings
    expect(prompt).toContain('## Purpose');
    expect(prompt).toContain('Generate Components');
  });

  it('select skill prompt includes utility-wrapper rejection rule (no authorable content surface)', async () => {
    const prompt = await buildPrompt({
      skill: 'select',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    // Distinctive phrase from the new rejection rule.
    expect(prompt).toContain('Utility wrapper — no authorable content surface');
    // The rule should call out structural-only props as a rejection signal.
    expect(prompt).toMatch(/structural[- ]only/i);
    // Concrete examples authors expect to be rejected.
    expect(prompt).toMatch(/Portal/);
    expect(prompt).toMatch(/SrOnly|screen[- ]reader[- ]only/i);
  });

  it('select skill prompt advertises batch input (1–N components per message)', async () => {
    const prompt = await buildPrompt({
      skill: 'select',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toMatch(/1[-–]N components/);
    expect(prompt).toMatch(/one tool call per input component/i);
  });

  it('select skill prompt preserves the renderer-vs-wrapper guardrail (data-fetch wrapper rule)', async () => {
    // Pin the existing rejection-criteria so the new rule is additive, not a replacement.
    const prompt = await buildPrompt({
      skill: 'select',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('Data-fetch wrapper rule');
    expect(prompt).toContain('React hooks');
  });

  describe('skillPathOverride (Feature 8)', () => {
    it('reads from override path when provided', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'eds-skill-override-'));
      try {
        const customPath = join(dir, 'custom-select.md');
        const marker = 'CUSTOM_SKILL_MARKER_8d3f7a1c';
        await writeFile(customPath, `# Custom\n\n${marker}\n`, 'utf8');
        const prompt = await buildPrompt({
          skill: 'select',
          mode: 'autonomous',
          rawComponentsInline: INLINE_COMPONENTS,
          outDir: '/fake/out',
          skillPathOverride: customPath,
        });
        expect(prompt).toContain(marker);
        // Bundled-prompt distinctive phrase should NOT appear.
        expect(prompt).not.toContain('Utility wrapper — no authorable content surface');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('throws a clear error citing the custom path when the override file is missing', async () => {
      await expect(
        buildPrompt({
          skill: 'select',
          mode: 'autonomous',
          rawComponentsInline: INLINE_COMPONENTS,
          outDir: '/fake/out',
          skillPathOverride: '/nonexistent/path/to/custom-prompt.md',
        }),
      ).rejects.toThrow(/custom prompt/i);
    });

    it('falls back to bundled path when override is undefined (behavior unchanged)', async () => {
      const prompt = await buildPrompt({
        skill: 'select',
        mode: 'autonomous',
        rawComponentsInline: INLINE_COMPONENTS,
        outDir: '/fake/out',
      });
      expect(prompt).toContain('Utility wrapper — no authorable content surface');
    });
  });

  describe('map-tokens skill', () => {
    const GENERATED_CDF = {
      Card: {
        $type: 'component',
        $properties: {
          bgColor: { $type: 'token', $category: 'design', '$token.kind': 'color' },
          title: { $type: 'string', $category: 'content' },
        },
      },
      Widget: {
        $type: 'component',
        $properties: {
          label: { $type: 'string', $category: 'content' },
        },
      },
    };
    const TOKEN_TREE = {
      colors: {
        surface: {
          default: { $type: 'color', $value: '#ffffff' },
          raised: { $type: 'color', $value: '#f5f5f5' },
        },
        brand: {
          primary: { $type: 'color', $value: '#0066ff' },
        },
      },
    };
    const SOURCE_REFS = [{ component: 'Card', sourcePath: 'src/Card.tsx', content: null }];
    const SOURCE_REFS_WITH_CONTENT = [
      {
        component: 'Card',
        sourcePath: 'src/Card.tsx',
        content: 'export function Card({ bgColor }) {\n  return <div style={{ background: bgColor }} />;\n}',
      },
    ];

    it('autonomous preamble includes map_token_prop tool-call protocol', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        componentSourceRefs: SOURCE_REFS,
        outDir: '/fake/out',
      });
      expect(prompt).toContain('map_token_prop');
      expect(prompt).toContain('token_allowed');
      expect(prompt).not.toMatch(/\btoken_sets\b/);
      expect(prompt).toContain('AUTONOMOUS mode');
    });

    it('includes only design-category token-typed props from the generated CDF', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        outDir: '/fake/out',
      });
      expect(prompt).toContain('bgColor');
      expect(prompt).toContain('Card');
      expect(prompt).not.toContain('"title"');
      expect(prompt).not.toContain('Widget');
    });

    it('flattens the token tree to a path + $type index with no $value', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        outDir: '/fake/out',
      });
      expect(prompt).toContain('{"path":"colors.surface.default","type":"color"}');
      expect(prompt).toContain('{"path":"colors.brand.primary","type":"color"}');
      expect(prompt).toContain('Token path index');
      expect(prompt).not.toContain('#ffffff');
      expect(prompt).not.toContain('#0066ff');
    });

    it('falls back to a path-only listing when content could not be read', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        componentSourceRefs: SOURCE_REFS,
        outDir: '/fake/out',
      });
      expect(prompt).toContain('Component source unavailable for');
      expect(prompt).toContain('src/Card.tsx');
    });

    it('inlines real file content as a fenced code block, not just the path', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        componentSourceRefs: SOURCE_REFS_WITH_CONTENT,
        outDir: '/fake/out',
      });
      expect(prompt).toContain('### Component source references');
      expect(prompt).toContain('```tsx');
      expect(prompt).toContain('background: bgColor');
      expect(prompt).not.toContain('Component source unavailable for');
    });

    // A computed signal that never reaches the prompt cannot change a
    // classification. Assert the rendered text, not just the field.
    it('renders the declared-but-never-read properties into the prompt', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        componentSourceRefs: [{ ...SOURCE_REFS_WITH_CONTENT[0], unconsumedProps: ['margin', 'marginTop'] }],
        outDir: '/fake/out',
      });
      expect(prompt).toContain('declared but no read found: margin, marginTop');
      expect(prompt).toContain('`token` cannot be earned');
      // The note must not overclaim: the scanner has blind spots, and saying so
      // is what stops the classifier treating the list as proof of non-use.
      expect(prompt).toContain('absence of consumption evidence');
    });

    // Silent truncation at the use site is what turned genuine token props
    // into enums. Stating it lets the classifier treat the gap as unknown.
    it('renders the props whose uses were cut by the snippet budget', async () => {
      const prompt = await buildPrompt({
        skill: 'components',
        mode: 'autonomous',
        rawComponentsInline: '[]',
        componentSourceRefs: [{ ...SOURCE_REFS_WITH_CONTENT[0], usesNotShown: ['padding'] }],
        outDir: '/fake/out',
        componentName: 'Card',
      });
      expect(prompt).toContain('uses not shown: padding');
      expect(prompt).toContain('unknown, not absent');
    });

    it('tells the components skill that unreadable source forfeits token, and map-tokens to emit nothing', async () => {
      const components = await buildPrompt({
        skill: 'components',
        mode: 'autonomous',
        rawComponentsInline: '[]',
        componentSourceRefs: SOURCE_REFS,
        outDir: '/fake/out',
        componentName: 'Card',
      });
      expect(components).toContain('Component source unavailable for');
      expect(components).toContain('`token` cannot be earned');
      expect(components).not.toContain('$token.kind alone');

      const mapTokens = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        componentSourceRefs: SOURCE_REFS,
        outDir: '/fake/out',
      });
      expect(mapTokens).toContain('emit nothing for their props');
      expect(mapTokens).not.toContain('$token.kind alone');
    });

    it('omits the declared-but-never-read note when every property is read', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        componentSourceRefs: [{ ...SOURCE_REFS_WITH_CONTENT[0], unconsumedProps: [] }],
        outDir: '/fake/out',
      });
      expect(prompt).not.toContain('declared but no read found');
    });

    it('inlines sibling files alongside the main component source', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        componentSourceRefs: [
          {
            ...SOURCE_REFS_WITH_CONTENT[0],
            siblingFiles: [
              { path: 'src/Card.styles.ts', content: 'export const cardColorMap = { primary: "blue500" };' },
            ],
          },
        ],
        outDir: '/fake/out',
      });
      expect(prompt).toContain('src/Card.styles.ts');
      expect(prompt).toContain('cardColorMap');
      expect(prompt).toContain('```ts');
    });

    it('omits sections entirely when there is no token data', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        outDir: '/fake/out',
      });
      expect(prompt).not.toContain('design-category token props only (JSON)');
      expect(prompt).not.toContain('Token path index — path and $type only');
      expect(prompt).not.toContain('### Component source references');
      expect(prompt).not.toContain('Component source unavailable for');
    });

    it('omits the generated-CDF section when no props are design-category tokens', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: {
          Widget: { $type: 'component', $properties: { label: { $type: 'string', $category: 'content' } } },
        },
        outDir: '/fake/out',
      });
      expect(prompt).not.toContain('design-category token props only (JSON)');
    });

    it('requires evidence before narrowing: emit nothing when unsupported, scoped by $token.kind', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        outDir: '/fake/out',
      });
      expect(prompt).toMatch(/emit nothing|omit.*token_allowed/i);
      expect(prompt).toMatch(/\$token\.kind/);
    });

    it('only narrows props that arrive without an existing token list', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        outDir: '/fake/out',
      });
      expect(prompt).toMatch(/without an existing|already (has|arrived|resolved)/i);
    });

    it('instructs never contradicting an existing tokenReference', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        outDir: '/fake/out',
      });
      expect(prompt).toContain('tokenReference');
      expect(prompt).toMatch(/never contradict/i);
    });

    it('includes skill file content', async () => {
      const prompt = await buildPrompt({
        skill: 'map-tokens',
        mode: 'autonomous',
        generatedCdf: GENERATED_CDF,
        tokenTree: TOKEN_TREE,
        outDir: '/fake/out',
      });
      expect(prompt).toContain('## Purpose');
      expect(prompt).toContain('Map Tokens');
    });
  });

  it('tokens autonomous preamble includes tool-call protocol instructions', async () => {
    const rawTokensInline = JSON.stringify([
      { name: '--color-primary', value: '#0066ff', source: 'css', inferredKind: 'color', ambiguous: false },
    ]);
    const prompt = await buildPrompt({
      skill: 'tokens',
      mode: 'autonomous',
      rawTokensInline,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('set_token');
    expect(prompt).toContain('set_group');
    expect(prompt).not.toContain('<<<EDS_OUTPUT_START>>>');
  });
});

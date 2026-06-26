import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrompt } from '../../src/generate/prompt-builder.js';

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

  it('interactive preamble does not include autonomous override', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'interactive',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('INTERACTIVE mode');
    expect(prompt).not.toContain('do not pause');
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

  it('lists "reason" as a required field on classify_prop with description orthogonality (Feature 1)', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    // The classify_prop example line should include both "description" and "reason".
    expect(prompt).toMatch(/classify_prop[^\n]*"description"[^\n]*"reason"|classify_prop[^\n]*"reason"[^\n]*"description"/);
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

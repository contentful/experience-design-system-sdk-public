/**
 * Converts benchmark run results + audit files into eval corpus entries.
 *
 * Usage:
 *   tsx scripts/build-corpus.ts \
 *     --benchmark-results <path/to/benchmark-run-output-dir> \
 *     --audits <path/to/audits-dir> \
 *     --out corpus/
 *
 * The benchmark results directory should contain one JSON file per repo
 * (RepoBenchmarkResult format) as written by the benchmark pipeline.
 *
 * The audits directory should contain one JSON file per repo
 * (AuditRecord format) as checked into packages/experience-design-system-cli/benchmarks/component-validation/audits/.
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { RawComponentDefinition } from '@contentful/experience-design-system-cli/src/types.js';

const RawComponentSchema: z.ZodType<RawComponentDefinition> = z.object({
  name: z.string(),
  source: z.string(),
  framework: z.string() as z.ZodType<RawComponentDefinition['framework']>,
  props: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      defaultValue: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
  slots: z.array(
    z.object({
      name: z.string(),
      required: z.boolean().optional(),
      description: z.string().optional(),
    }),
  ),
});

const BenchmarkResultSchema = z.object({
  schemaVersion: z.literal(1),
  repoId: z.string(),
  status: z.string(),
  components: z.array(RawComponentSchema),
});

const AuditEntrySchema = z.object({
  componentName: z.string(),
  source: z.string(),
  verdict: z.enum(['accurate', 'partial', 'missed', 'incorrect']),
  // free-text notes — not structured into prop mappings
  expected: z
    .object({
      hasComponent: z.boolean().optional(),
      propNotes: z.string().optional(),
      slotNotes: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
});

const AuditRecordSchema = z.object({
  schemaVersion: z.literal(1),
  repoId: z.string(),
  sampleSize: z.number(),
  entries: z.array(AuditEntrySchema),
});

async function loadJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await readFile(path, 'utf8');
  return schema.parse(JSON.parse(raw));
}

async function main() {
  const { values } = parseArgs({
    options: {
      'benchmark-results': { type: 'string' },
      audits: { type: 'string' },
      out: { type: 'string', default: 'corpus' },
    },
  });

  const benchmarkDir = values['benchmark-results'];
  const auditsDir = values['audits'];
  const outDir = values['out'] ?? 'corpus';

  if (!benchmarkDir || !auditsDir) {
    console.error('Usage: tsx scripts/build-corpus.ts --benchmark-results <dir> --audits <dir> [--out <dir>]');
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });

  const auditFiles = (await readdir(auditsDir)).filter((f) => extname(f) === '.json');
  const benchmarkFiles = (await readdir(benchmarkDir)).filter((f) => extname(f) === '.json');

  // Index benchmark results by repoId
  const benchmarkByRepo = new Map<string, Awaited<ReturnType<typeof loadJson<z.infer<typeof BenchmarkResultSchema>>>>>();
  for (const file of benchmarkFiles) {
    try {
      const result = await loadJson(join(benchmarkDir, file), BenchmarkResultSchema);
      benchmarkByRepo.set(result.repoId, result);
    } catch (e) {
      console.warn(`Skipping benchmark file ${file}: ${e instanceof Error ? e.message : e}`);
    }
  }

  let written = 0;
  let skipped = 0;

  for (const auditFile of auditFiles) {
    const repoId = basename(auditFile, '.json');

    let audit: z.infer<typeof AuditRecordSchema>;
    try {
      audit = await loadJson(join(auditsDir, auditFile), AuditRecordSchema);
    } catch (e) {
      console.warn(`Skipping audit ${auditFile}: ${e instanceof Error ? e.message : e}`);
      skipped++;
      continue;
    }

    const benchmarkResult = benchmarkByRepo.get(repoId);
    if (!benchmarkResult) {
      console.warn(`No benchmark run result found for ${repoId} — skipping. Run the benchmark first.`);
      skipped++;
      continue;
    }

    // Index extracted components by source path for fast lookup
    const componentsBySource = new Map<string, RawComponentDefinition>();
    for (const component of benchmarkResult.components) {
      componentsBySource.set(component.source, component);
    }

    // Only include audit entries where we actually have Stage 0 output
    const rawComponents: RawComponentDefinition[] = [];
    const expectedComponents: Array<{
      name: string;
      verdict: string;
      expectedNotes?: { propNotes?: string; slotNotes?: string };
    }> = [];

    for (const entry of audit.entries) {
      // The audit source path uses repo-relative paths; benchmark stores absolute paths.
      // Match by suffix since benchmark paths are absolute and audit paths are relative.
      const match = benchmarkResult.components.find(
        (c) =>
          c.source.endsWith(entry.source) ||
          // fallback: match by component name if source path doesn't align
          c.name === entry.componentName,
      );

      if (match) {
        rawComponents.push(match);
        expectedComponents.push({
          name: entry.componentName,
          verdict: entry.verdict,
          ...(entry.expected?.propNotes || entry.expected?.slotNotes
            ? {
                expectedNotes: {
                  propNotes: entry.expected?.propNotes,
                  slotNotes: entry.expected?.slotNotes,
                },
              }
            : {}),
        });
      } else {
        // Still add to expectedComponents so coverage scoring works
        expectedComponents.push({
          name: entry.componentName,
          verdict: entry.verdict,
        });
      }
    }

    const corpusEntry = {
      repo: repoId,
      rawComponents,
      expectedComponents,
    };

    const outPath = join(outDir, `${repoId}.json`);
    await writeFile(outPath, `${JSON.stringify(corpusEntry, null, 2)}\n`);
    console.log(`  wrote ${outPath} (${rawComponents.length} components matched of ${audit.entries.length} audited)`);
    written++;
  }

  console.log(`\nDone. ${written} corpus files written, ${skipped} skipped.`);
  console.log(`\nNext: run 'pnpm start' from services/dsi-eval/ to execute the eval.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

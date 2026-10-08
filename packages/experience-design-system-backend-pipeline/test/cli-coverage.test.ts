import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { describe, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const CLI_SRC = resolve(repoRoot, 'packages/experience-design-system-cli-legacy/src');
const BACKEND_INDEX = resolve(repoRoot, 'packages/experience-design-system-backend-pipeline/src/index.ts');

/**
 * Modules the CLI imports from that are DELIBERATELY not ported to the backend.
 * Keep this list honest — don't add paths just to silence this test; add them
 * only when the symbol is a true CLI/TUI concern.
 */
const CLI_ONLY_MODULE_SUBSTRINGS = [
  // TUI (Ink views, hooks, keyboard, rendering)
  '/tui/',
  '/import/',
  '/components/', // Ink JSX components
  '/hooks/',
  // Analytics (Segment emission — pipeline is pure)
  '/analytics/',
  // CLI output formatting (ANSI, progress bars, interactive terminal)
  '/output/',
  '/lib/',
  // First-run setup wizard
  '/setup/',
  // Commander registration glue (register*Command)
  '/program',
  // Doctor (toolchain preflight — CLI owns)
  '/doctor/',
  // CLI-local legacy types module (RawComponentDefinition, ExtractionValidationIssue, etc.
  // — the CLI re-exports these; new code should import from the backend barrel).
  '/experience-design-system-cli-legacy/src/types',
  // TUI-specific tree + cascade math (operates on view state, not pipeline state)
  '/analyze/composite-closure',
  '/analyze/fuzzy-search',
  '/analyze/issue-inheritance',
  '/analyze/scope-gate-cascade',
  '/analyze/search-neighborhood',
  '/analyze/selection-cascade',
  '/analyze/lineage',
  '/composite-closure',
  '/cycle-detection',
  '/cycle-auto-reject',
  '/path-utils',
  '/ai-flag',
  // Legacy runs/ files that are TUI (path-prompt renders Ink)
  '/runs/path-prompt',
  // Analyze subcommand TUI wrappers (component.tsx, etc.)
  '/StepLayout',
  // Wizard state machines live in CLI
  '/wizard-',
  '/wrap-text',
  // Legacy session-internal repository/service files — surface via barrel instead
  // of letting CLI reach into private modules.
  '/session/repositories/',
  '/session/services/',
  '/session/core/',
];

/**
 * Symbol names that are TUI/CLI-only even when their module name doesn't tip us off.
 */
const CLI_ONLY_SYMBOL_PATTERNS: RegExp[] = [
  /^register[A-Z]\w+Command$/, // Commander: registerApplyCommand, registerPrintCommand, …
  // Ink component / React view types + helpers
  /^TokenPropSuggestion$/,
  /^TokenReviewToken$/,
  /^TokenReviewPanel$/,
  /^collectTokenSuggestions$/,
  /^GroupedSidebarItem$/,
  /^buildVisibleRows$/,
  /^HelpSection$/,
  /^HelpOverlay$/,
  /^FINALIZE_REMOVED_WINDOW$/,
  /^FinalizeDialog$/,
  /^ImmediateInputKey$/,
  /^computeNextScrollOffset$/,
  /View$/, // every Ink view component (MapTokensView, ApplyView, GenerateView, …)
];

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir);
  await Promise.all(
    entries.map(async (name) => {
      const full = resolve(dir, name);
      const s = await stat(full);
      if (s.isDirectory()) await walk(full, out);
      else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
    }),
  );
  return out;
}

interface Import {
  symbol: string;
  module: string;
  file: string;
}

function collectCliImports(files: string[]): Import[] {
  const out: Import[] = [];
  const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gs;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(text)) !== null) {
      const [names, mod] = [m[1], m[2]];
      if (!names || !mod) continue;
      if (!mod.startsWith('.')) continue; // skip npm imports
      // Resolve to an absolute path (strip .js extension if present) so pattern
      // matches work against the real module location, not whatever `../`-depth
      // the importer used.
      const stripped = mod.endsWith('.js') ? mod.slice(0, -3) : mod;
      const abs = resolve(dirname(file), stripped);
      for (const raw of names.split(',')) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const noType = trimmed.replace(/^type\s+/, '');
        const localName = noType.split(' as ')[0]!.trim(); // "X" or "X as Y" → "X"
        if (localName) out.push({ symbol: localName, module: abs, file });
      }
    }
  }
  return out;
}

function collectBackendExports(indexPath: string): Set<string> {
  const text = readFileSync(indexPath, 'utf8');
  const exports = new Set<string>();
  const re = /export\s+(?:type\s+)?\{([^}]+)\}/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const raw of m[1]!.split(',')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const noType = trimmed.replace(/^type\s+/, '');
      if (noType.includes(' as ')) {
        const [orig, alias] = noType.split(' as ').map((s) => s.trim());
        if (orig) exports.add(orig);
        if (alias) exports.add(alias);
      } else {
        exports.add(noType);
      }
    }
  }
  // `export * as doctor from ...` style namespace exports
  for (const nm of text.matchAll(/export\s+\*\s+as\s+(\w+)\s+from/g)) {
    exports.add(nm[1]!);
  }
  return exports;
}

function isCliOnlyModule(mod: string): boolean {
  return CLI_ONLY_MODULE_SUBSTRINGS.some((frag) => mod.includes(frag));
}

function isCliOnlySymbol(sym: string): boolean {
  return CLI_ONLY_SYMBOL_PATTERNS.some((re) => re.test(sym));
}

describe('cli-legacy → backend-pipeline symbol coverage', () => {
  it('every CLI internal import either stays in CLI by design or resolves to a backend export', async () => {
    const files = await walk(CLI_SRC);
    const imports = collectCliImports(files);
    const backendExports = collectBackendExports(BACKEND_INDEX);

    const missing: Record<string, Set<string>> = {};
    for (const imp of imports) {
      if (isCliOnlyModule(imp.module)) continue;
      if (isCliOnlySymbol(imp.symbol)) continue;
      if (backendExports.has(imp.symbol)) continue;
      (missing[imp.module] ??= new Set()).add(imp.symbol);
    }

    // Build a human-readable report so CI output is actionable.
    const lines: string[] = [];
    for (const mod of Object.keys(missing).sort()) {
      lines.push(`  ${mod}`);
      for (const sym of [...missing[mod]!].sort()) {
        lines.push(`    - ${sym}`);
      }
    }

    if (lines.length > 0) {
      throw new Error(
        [
          `${Object.values(missing).reduce((n, s) => n + s.size, 0)} CLI import(s) do not resolve to a backend export.`,
          'Either (a) add the symbol to the backend barrel, or (b) if it is CLI/TUI/analytics-only, add',
          'its module fragment to CLI_ONLY_MODULE_SUBSTRINGS or symbol to CLI_ONLY_SYMBOL_PATTERNS',
          'in this test (and document why).',
          '',
          ...lines,
        ].join('\n'),
      );
    }
  });

});

import { dirname } from 'node:path';
import type { CompositionEdge } from './interchange-schema.js';

type CandidateFile = { path: string; content: string };
type ComponentRef = { name: string; sourcePath?: string };

/**
 * Prompt-injection safeguard for this signal: both parsers below are plain
 * deterministic code, never an LLM prompt. `manifest.json`/`AGENTS.md`
 * content is attacker-adjacent (Figma-authored / free-form prose respectively)
 * but it only ever flows through JSON field access and a fixed regex, then is
 * validated against the real `componentNames` allowlist before an edge is
 * emitted — there is no path from this file's content to model instructions.
 */

/** Figma/manifest names are kebab-case (`blue-accordion-item`); React exports are PascalCase. */
export function kebabToPascal(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
}

/**
 * Deterministic parse of a Figma-exported `manifest.json` — no LLM involved.
 * Schema (confirmed against a real design-system manifest):
 *   { component: { name: "blue-accordion" },
 *     variantsMeta: { componentPropertyDefinitions: {
 *       "Slot#1533:33": { type: "SLOT", preferredValues: [{ name: "blue-accordion-item" }] }
 *     } } }
 * The manifest's own `component.name` identifies its owning/parent component
 * (more robust than inferring from directory proximity, since manifest.json
 * typically lives one level below the component's source file, e.g. in a
 * sibling `design/` directory).
 */
export function collectManifestEdges(files: CandidateFile[], componentNames: ReadonlySet<string>): CompositionEdge[] {
  const edges: CompositionEdge[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!file.path.endsWith('manifest.json')) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const root = parsed as Record<string, unknown>;

    const component = root.component;
    const rawParentName =
      typeof component === 'object' && component !== null && typeof (component as Record<string, unknown>).name === 'string'
        ? ((component as Record<string, unknown>).name as string)
        : undefined;
    if (!rawParentName) continue;
    const parent = kebabToPascal(rawParentName);
    if (!componentNames.has(parent)) continue;

    const variantsMeta = root.variantsMeta;
    const propDefs =
      typeof variantsMeta === 'object' && variantsMeta !== null
        ? (variantsMeta as Record<string, unknown>).componentPropertyDefinitions
        : undefined;
    if (typeof propDefs !== 'object' || propDefs === null) continue;

    for (const def of Object.values(propDefs as Record<string, unknown>)) {
      if (typeof def !== 'object' || def === null) continue;
      const defObj = def as Record<string, unknown>;
      if (defObj.type !== 'SLOT') continue;
      const preferredValues = Array.isArray(defObj.preferredValues) ? defObj.preferredValues : [];

      for (const value of preferredValues) {
        if (typeof value !== 'object' || value === null) continue;
        const rawChildName = (value as Record<string, unknown>).name;
        if (typeof rawChildName !== 'string') continue;
        const child = kebabToPascal(rawChildName);
        if (!componentNames.has(child) || child === parent) continue;

        const key = `${parent}::${child}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ parent, child, provenance: 'manifest' });
      }
    }
  }

  return edges;
}

const DOC_COMPOSITION_KEYWORDS = ['slot', 'child', 'children', 'compose', 'nested', 'contains', 'wraps'];
const BOLD_BACKTICK = /\*\*`([^`]+)`\*\*/g;

/**
 * Deterministic parse of a component-level `AGENTS.md` — no LLM involved.
 * Only a bold-backtick component mention (`` **`ComponentName`** ``) on a
 * line that ALSO carries a composition keyword is accepted, e.g. "Direct
 * **`AccordionItem`** children only." A bare cross-reference mention (no
 * composition keyword on the same line, e.g. "see `other-component`") is
 * rejected — it isn't asserting a parent-child relationship.
 *
 * The doc's owning component is resolved by directory colocation: the
 * component whose `sourcePath` sits in the same directory as the doc file
 * (the real-world convention — `<component>/AGENTS.md` next to
 * `<component>/Component.tsx`).
 */
export function collectAgentsDocEdges(
  files: CandidateFile[],
  components: ComponentRef[],
  componentNames: ReadonlySet<string>,
): CompositionEdge[] {
  const edges: CompositionEdge[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!file.path.endsWith('AGENTS.md')) continue;
    const docDir = dirname(file.path);
    const parent = components.find((c) => c.sourcePath && dirname(c.sourcePath) === docDir)?.name;
    if (!parent || !componentNames.has(parent)) continue;

    for (const line of file.content.split('\n')) {
      const lower = line.toLowerCase();
      if (!DOC_COMPOSITION_KEYWORDS.some((kw) => lower.includes(kw))) continue;

      for (const match of line.matchAll(BOLD_BACKTICK)) {
        const raw = match[1];
        const candidate = componentNames.has(raw) ? raw : kebabToPascal(raw);
        if (!componentNames.has(candidate) || candidate === parent) continue;

        const key = `${parent}::${candidate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ parent, child: candidate, provenance: 'doc' });
      }
    }
  }

  return edges;
}

/** Both deterministic sources, combined for the `extraEdges` wiring in command.ts. */
export function collectManifestDocEdges(
  files: CandidateFile[],
  components: ComponentRef[],
  componentNames: ReadonlySet<string>,
): CompositionEdge[] {
  return [...collectManifestEdges(files, componentNames), ...collectAgentsDocEdges(files, components, componentNames)];
}

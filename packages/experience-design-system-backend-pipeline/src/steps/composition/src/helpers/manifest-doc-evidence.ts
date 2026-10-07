import { dirname } from 'node:path';
import type { CandidateFile } from '../../../shared/index.js';
import type { CompositionEdge } from './interchange-schema.js';

type ComponentRef = { name: string; sourcePath?: string };

export function kebabToPascal(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
}

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
      typeof component === 'object' &&
      component !== null &&
      typeof (component as Record<string, unknown>).name === 'string'
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

export function collectManifestDocEdges(
  files: CandidateFile[],
  components: ComponentRef[],
  componentNames: ReadonlySet<string>,
): CompositionEdge[] {
  return [...collectManifestEdges(files, componentNames), ...collectAgentsDocEdges(files, components, componentNames)];
}

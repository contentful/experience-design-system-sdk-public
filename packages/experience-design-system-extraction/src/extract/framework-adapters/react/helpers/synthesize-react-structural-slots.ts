import type { RawComponentDefinition, RawSlotDefinition } from '../../../types/component.js';
import {
  collectTypePredicateComponentReferences,
  collectRuntimeTypeCheckComponentReferences,
  collectRenderedComponentReferences,
  collectArrayMapRenderComponentReferences,
} from '../../../helpers/evidence/collect-jsx-component-references.js';
import type { FunctionLike } from './resolve-component-function.js';
import type { Project } from 'ts-morph';

type RawSlotDefinitionInternal = RawSlotDefinition & { _rawTypeText?: string };
type ComponentWithFuncNode = RawComponentDefinition & { _funcNode?: FunctionLike };

export function synthesizeReactStructuralSlots(
  components: ComponentWithFuncNode[],
  project: Project | undefined,
): void {
  const propsToComponent = new Map<string, string>();
  const componentNames = new Set<string>();
  for (const c of components as Array<RawComponentDefinition & { _propsTypeName?: string }>) {
    componentNames.add(c.name);
    if (c._propsTypeName) propsToComponent.set(c._propsTypeName, c.name);
  }

  const structuralByFile = new Map<string, string[]>();
  const structuralNamesForFile = (filePath: string): string[] => {
    const cached = structuralByFile.get(filePath);
    if (cached) return cached;
    const sourceFile = project?.getSourceFile(filePath);
    if (!sourceFile) return [];
    const ctx = { propsToComponent, componentNames };
    const found = new Set<string>([
      ...collectTypePredicateComponentReferences(sourceFile, ctx),
      ...collectRuntimeTypeCheckComponentReferences(sourceFile, componentNames),
    ]);
    const names = [...found].sort();
    structuralByFile.set(filePath, names);
    return names;
  };

  for (const c of components) {
    const fromFile = structuralNamesForFile(c.source);
    const fromRender = c._funcNode ? collectRenderedComponentReferences(c._funcNode, componentNames, c.name) : [];
    const propTypesByName = new Map(c.props.map((p) => [p.name, p.type]));
    const fromArrayMap = c._funcNode
      ? collectArrayMapRenderComponentReferences(c._funcNode, componentNames, c.name, propTypesByName)
      : [];
    const structural = new Set([...fromFile, ...fromRender, ...fromArrayMap]);
    if (structural.size === 0) continue;

    const synthesisedSlot: RawSlotDefinitionInternal | undefined =
      fromArrayMap.length > 0 && c.slots.length === 0 ? { name: 'children', isDefault: true } : undefined;
    if (synthesisedSlot) (c.slots as RawSlotDefinitionInternal[]).push(synthesisedSlot);

    for (const slot of c.slots as RawSlotDefinitionInternal[]) {
      if (slot.allowedComponents && slot.allowedComponents.length > 0) continue;
      slot.structuralAllowedComponents =
        slot === synthesisedSlot ? [...fromArrayMap].sort() : [...structural].sort();
    }
  }

  for (const c of components) {
    delete c._funcNode;
  }
}

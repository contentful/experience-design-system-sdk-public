import { Project } from 'ts-morph';
import {
  attachComponentModelPlan,
  buildCDF,
  deriveEditableRepresentationPlans,
  parseCDFComponents,
  type PropertyModel,
} from '@contentful/experience-design-system-types';
import { captureNativeSource } from '../../src/steps/extraction/src/candidates/native-source.js';

export function createRecursiveModelFamily() {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const declaration = project
    .createSourceFile('/models.ts', 'export type ModelNode = {label:string; branch:{rank:number; parent?:ModelNode}};')
    .getTypeAliasOrThrow('ModelNode');
  const captured = captureNativeSource(declaration.getType(), declaration, true, ['settings']);
  const model: PropertyModel = {
    identity: {
      componentId: 'Example',
      propertyId: '["Example","settings"]',
      key: 'settings',
      sourceRevision: 'revision',
      nodeId: captured.graph.rootId,
    },
    source: { typeText: 'ModelNode', shape: captured.shape, graph: captured.graph, observations: [] },
    category: 'content',
    defaultIntent: { action: 'absent' },
  };
  const plan = deriveEditableRepresentationPlans(model).find((candidate) => candidate.kind === 'component-model')!;
  const cdf = buildCDF(
    [{ key: 'Example', entry: attachComponentModelPlan({ $type: 'component', $properties: {} }, plan) }],
    [],
  )!;
  return { plan, cdf, components: parseCDFComponents(cdf).components };
}

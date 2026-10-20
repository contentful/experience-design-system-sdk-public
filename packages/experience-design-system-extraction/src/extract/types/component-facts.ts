import type { SourceFactCertainty, SourceFactLocation, SourceFactOrigin } from '../candidates/types.js';

export const COMPONENT_FACT_SCHEMA_VERSION = 1;
export type ComponentEvidenceReadStatus = 'available' | 'unknown-legacy' | 'corrupt' | 'unsupported';

/** Plain observations, independent of authoring decisions and prop candidates. */
export interface ComponentFactObservation {
  certainty: SourceFactCertainty;
  location: SourceFactLocation | null;
  /** Exact declared text when observed; absent means unknown. */
  sourceTypeText?: string;
}
export interface RenderableFact extends ComponentFactObservation {
  name: string;
  delivery: 'node-prop' | 'named-slot' | 'scoped-slot' | 'render-function';
  usage?: 'cloned' | 'props-read' | 'element-check' | 'placed';
  /** Null or absent means the compiler did not establish element typing. */
  elementTyped?: boolean | null;
  typeName?: string;
  origin?: SourceFactOrigin;
}
export interface MemberFact extends ComponentFactObservation {
  name: string;
  exportName?: string;
}
export interface ChildFilterFact extends ComponentFactObservation {
  slot: string;
  kind: 'type-check' | 'display-name' | 'vnode-name' | 'jsdoc-slot';
  allowed: string[];
}
export interface RequiresParentFact extends ComponentFactObservation {
  parent: string;
  reason: 'context-throws' | 'context-missing' | 'inject-no-default';
}
export interface NonStaticFact extends ComponentFactObservation {
  kind: 'callback' | 'controlled-pair' | 'ref' | 'external-call' | 'context-read' | 'portal';
  name?: string;
  hasDefault?: boolean;
  throwsWithoutProvider?: boolean;
  provider?: 'component' | 'host-application' | 'unknown';
  declaredIn?: string;
  packageName?: string;
}
export interface ComponentOriginFact extends ComponentFactObservation {
  kind: 'in-folder' | 'in-repository' | 'external-package' | 'unresolved';
  realPath?: string;
  packageName?: string;
}
export interface ReferencedOriginFact extends ComponentFactObservation {
  name: string;
  symbolName?: string;
  origin: ComponentOriginFact;
}
export interface ComponentFacts {
  schemaVersion: typeof COMPONENT_FACT_SCHEMA_VERSION;
  renderables?: RenderableFact[];
  members?: MemberFact[];
  childFilters?: ChildFilterFact[];
  requiresParent?: RequiresParentFact[];
  nonStatic?: NonStaticFact[];
  origin?: ComponentOriginFact;
  referencedOrigins?: ReferencedOriginFact[];
}

/** Collector input is plain source data; compiler objects stay in collector closures. */
export interface ComponentFactContext {
  name: string;
  sourcePath: string;
  framework: 'react' | 'next';
  sourceText: string;
  declaration: SourceFactLocation | null;
  declaredTypeText: string | null;
}
export type ComponentFactInput = Omit<ComponentFactContext, 'declaration'> & {
  /** Exact offsets and lines in sourceText; absent means unknown location. */
  sourceRange?: { startLine: number; endLine: number; startOffset: number; endOffset: number };
};
/** Each collector owns one evidence field and cannot change authoring props or slots. */
export type ComponentFactCollectors = {
  [Field in keyof Omit<ComponentFacts, 'schemaVersion'>]?: (
    context: Readonly<ComponentFactContext>,
  ) => ComponentFacts[Field];
};

import type { CDFComponentEntry } from '../../../shared/index.js';

export interface ComponentGraphNode {
  name: string;
  slots: Array<{ name: string; allowedComponents?: string[] }>;
}

export interface ComponentGraphInput {
  key: string;
  entry: CDFComponentEntry;
  status?: string;
}

export interface SlotEdge {
  fromComponent: string;
  slotName: string;
  toComponent: string;
}

export interface SlotCycle {
  path: string[];
  edges: SlotEdge[];
}

export interface CyclePathSegment {
  kind: 'component' | 'slot' | 'arrow';
  text: string;
}

export interface CycleAwareRejectResult {
  toReject: Set<string>;
  toDeselect: Set<string>;
  cyclePartners: string[];
}

export type NodeStatus = 'ok' | 'warning' | 'error';

export interface RenderStatus {
  status: NodeStatus;
  isOwn: boolean;
  sourceComponents: string[];
}

export interface ClosureNode {
  name: string;
  depth: number;
  path: string[];
  parents: string[];
}

export interface Closure {
  root: string;
  nodes: ClosureNode[];
  containsCycle: boolean;
  cyclePath?: string[];
}

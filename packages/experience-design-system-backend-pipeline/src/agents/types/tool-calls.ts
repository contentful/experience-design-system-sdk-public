import type { ClassifiedPropertyCall } from '@contentful/experience-design-system-types';

interface ExcludePropCall {
  tool: 'exclude_prop';
  prop: string;
  reason: string;
}

interface ClassifyComponentCall {
  tool: 'classify_component';
  description?: string;
  rationale?: {
    description?: string;
    props?: string;
    slots?: string;
  };
}

interface ClassifySlotCall {
  tool: 'classify_slot';
  slot: string;
  required?: boolean;
  allowed_components?: string[];
  description?: string;
  rationale?: string;
}

export type ToolCall = ClassifiedPropertyCall | ExcludePropCall | ClassifyComponentCall | ClassifySlotCall;

export interface SelectComponentCall {
  tool: 'select_component';
  name: string;
  reason?: string;
  confidence?: number;
}

export interface RejectComponentCall {
  tool: 'reject_component';
  name: string;
  reason?: string;
  confidence?: number;
}

export type SelectToolCall = SelectComponentCall | RejectComponentCall;

export interface ParsedSelectToolCalls {
  calls: SelectToolCall[];
  warnings: string[];
}

export interface SetTokenCall {
  tool: 'set_token';
  path: string;
  type: string;
  value: unknown;
  description?: string;
}

export interface SetGroupCall {
  tool: 'set_group';
  path: string;
  description?: string;
}

export type TokenToolCall = SetTokenCall | SetGroupCall;

export interface ParsedTokenToolCalls {
  calls: TokenToolCall[];
  warnings: string[];
}

export interface MapTokenPropCall {
  tool: 'map_token_prop';
  component: string;
  prop: string;
  token_allowed: string[];
}

export interface ParsedMapTokenPropToolCalls {
  calls: MapTokenPropCall[];
  warnings: string[];
}

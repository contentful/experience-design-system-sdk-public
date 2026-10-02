export interface ClassifyPropCall {
  tool: 'classify_prop';
  prop: string;
  cdf_type: string;
  cdf_category: 'content' | 'design' | 'state';
  values?: string[];
  token_kind?: string;
  required?: boolean;
  description?: string;
  default?: string | boolean;
  /** Internal LLM rationale; not customer-facing. Persisted to raw_props.rationale. */
  reason?: string;
}

export interface ExcludePropCall {
  tool: 'exclude_prop';
  prop: string;
  reason: string;
}

export interface ClassifyComponentCall {
  tool: 'classify_component';
  description?: string;
  /**
   * Component-level rationale strings. Surfaced by the `I` ComponentRationalePanel.
   * Each field is optional; missing fields leave existing DB values untouched
   * (sparse update semantics in applyToolCalls).
   */
  rationale?: {
    description?: string;
    props?: string;
    slots?: string;
  };
}

export interface ClassifySlotCall {
  tool: 'classify_slot';
  slot: string;
  required?: boolean;
  allowed_components?: string[];
  description?: string;
  /** Per-slot rationale; persisted to raw_slots.rationale. */
  rationale?: string;
}

export type ToolCall = ClassifyPropCall | ExcludePropCall | ClassifyComponentCall | ClassifySlotCall;

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

export interface ParsedToolCalls {
  calls: ToolCall[];
  warnings: string[];
}

export interface MapTokenPropCall {
  tool: 'map_token_prop';
  component: string;
  prop: string;
  /** Narrowed subset of tokens the prop may draw from. Required and non-empty. */
  token_allowed: string[];
}

export interface ParsedMapTokenPropToolCalls {
  calls: MapTokenPropCall[];
  warnings: string[];
}

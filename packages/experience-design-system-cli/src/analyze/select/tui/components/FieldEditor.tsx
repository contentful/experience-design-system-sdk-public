import React, { useState } from 'react';
import { Box, Text } from 'ink';
import {
  CDF_PROPERTY_TYPES,
  CDF_PROPERTY_CATEGORIES,
  DESIGN_TOKEN_TYPES,
} from '@contentful/experience-design-system-types';
import type {
  CDFComponentEntry,
  CDFPropertyDefinition,
  CDFSlotDefinition,
} from '@contentful/experience-design-system-types';
import { useImmediateInput } from '../hooks/useImmediateInput.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Per-prop / per-component metadata captured by the extractor + generate phase.
 * Optional; when omitted, the FieldEditor renders without rationale/source
 * affordances (backwards-compatible with mounts that pre-date Feature 1). */
export type PropMetadata = {
  rationale?: string | null;
  sourceStartLine?: number | null;
  sourceEndLine?: number | null;
};

export type FieldEditorMetadata = {
  /** Absolute path to the component's source file. Null/undefined = unknown. */
  sourcePath?: string | null;
  /** Full source text of the component (used by the source-view panel). */
  componentSource?: string | null;
  /** Per-prop metadata keyed by prop name. */
  props?: Record<string, PropMetadata>;
};

type FieldEditorProps = {
  value: string;
  width: number;
  height: number;
  /**
   * When false, the editor is mounted but does not consume keystrokes.
   * Used by callers (e.g. GenerateReviewStep) that toggle focus between
   * a sidebar and this editor — the editor stays visible while the sidebar
   * has the keyboard.
   */
  active?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  /**
   * Called when the user requests to exit the panel from row-level (Esc).
   * Distinct from onDiscard, which drops pending edits without changing focus.
   * Callers that embed FieldEditor inside a sidebar+panel layout wire this to
   * return focus to the sidebar (e.g. setSidebarFocused(true)). When omitted,
   * row-level Esc falls back to onDiscard for backward compatibility.
   */
  onExit?: () => void;
  /** Feature 1: source code + LLM rationale metadata. Optional. */
  metadata?: FieldEditorMetadata;
};

/**
 * A cursor position inside the editor.
 *
 * Navigation levels:
 *   'section'  — top-level: component $description, $properties header, $slots header
 *   'prop'     — a $properties entry (name + its fields shown inline)
 *   'slot'     — a $slots entry
 *   'field'    — an individual field inside the active prop/slot (editing mode)
 *
 * Note: the previous `'value'` level was flattened — when activeField is `'values'`,
 * value-list manipulation (a/e/r/reorder) happens directly without an extra Return.
 */
type FocusLevel = 'section' | 'prop' | 'slot' | 'field' | 'componentDescription';

type PropState = {
  name: string;
  type: (typeof CDF_PROPERTY_TYPES)[number];
  category: (typeof CDF_PROPERTY_CATEGORIES)[number];
  required: boolean;
  description: string;
  values: string[];
  tokenKind: string;
  /**
   * Per-prop $default. null = unset. For boolean props the value is a
   * boolean; for all other types it's stored as a string and serialized
   * verbatim. richtext/media/link don't use this slot — defaults aren't
   * meaningful for those types and the field is omitted from the cycle.
   */
  default: string | boolean | null;
};

type SlotState = {
  name: string;
  description: string;
  required: boolean;
  /** $allowedComponents — list of component names. Empty = "any". */
  allowedComponents: string[];
};

type EditorState = {
  componentDescription: string;
  props: PropState[];
  slots: SlotState[];
};

// Section indices for top-level navigation
// 0 = component $description row
// 1 = $properties header (then props[0..n-1])
// 2 = $slots header (then slots[0..m-1])

// ── Parsing helpers ───────────────────────────────────────────────────────────

function parseToState(json: string): { state: EditorState; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { state: { componentDescription: '', props: [], slots: [] }, error: String(e) };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      state: { componentDescription: '', props: [], slots: [] },
      error: 'Expected a JSON object',
    };
  }

  const entry = parsed as Record<string, unknown>;

  // Handle both bare CDFComponentEntry and wrapped { [name]: entry } forms
  let component: Record<string, unknown>;
  const keys = Object.keys(entry);
  if (entry.$type === 'component' || entry.$properties !== undefined) {
    component = entry;
  } else if (keys.length === 1 && typeof entry[keys[0]] === 'object') {
    component = entry[keys[0]] as Record<string, unknown>;
  } else {
    component = entry;
  }

  const componentDescription = typeof component.$description === 'string' ? component.$description : '';

  const rawProps = (component.$properties ?? {}) as Record<string, unknown>;
  const props: PropState[] = Object.entries(rawProps).map(([name, raw]) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const type = CDF_PROPERTY_TYPES.includes(p.$type as never) ? (p.$type as PropState['type']) : 'string';
    let defaultValue: string | boolean | null = null;
    if (p.$default !== undefined && p.$default !== null) {
      if (type === 'boolean') {
        defaultValue = typeof p.$default === 'boolean' ? p.$default : null;
      } else {
        // Store as string for string/number/token/enum. Numbers/JSON values
        // are stringified — downstream serialization re-emits the string.
        defaultValue = typeof p.$default === 'string' ? p.$default : String(p.$default);
      }
    }
    return {
      name,
      type,
      category: CDF_PROPERTY_CATEGORIES.includes(p.$category as never)
        ? (p.$category as PropState['category'])
        : 'content',
      required: p.$required === true,
      description: typeof p.$description === 'string' ? p.$description : '',
      values: Array.isArray(p.$values) ? (p.$values as string[]).filter((v) => typeof v === 'string') : [],
      tokenKind: typeof p['$token.kind'] === 'string' ? p['$token.kind'] : '',
      default: defaultValue,
    };
  });

  const rawSlots = (component.$slots ?? {}) as Record<string, unknown>;
  const slots: SlotState[] = Object.entries(rawSlots).map(([name, raw]) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    return {
      name,
      description: typeof s.$description === 'string' ? s.$description : '',
      required: s.$required === true,
      allowedComponents: Array.isArray(s.$allowedComponents)
        ? (s.$allowedComponents as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
    };
  });

  return { state: { componentDescription, props, slots }, error: null };
}

function serializeState(state: EditorState, originalJson: string): string {
  // Preserve the wrapper key if the original was wrapped
  let wrapperKey: string | null = null;
  try {
    const orig = JSON.parse(originalJson) as Record<string, unknown>;
    const keys = Object.keys(orig);
    if (keys.length === 1 && orig[keys[0]] !== null && typeof orig[keys[0]] === 'object') {
      const inner = orig[keys[0]] as Record<string, unknown>;
      if (inner.$type === 'component' || inner.$properties !== undefined) {
        wrapperKey = keys[0];
      }
    }
  } catch {
    // ignore
  }

  const $properties: Record<string, CDFPropertyDefinition> = {};
  for (const p of state.props) {
    const def: CDFPropertyDefinition = {
      $type: p.type,
      $category: p.category,
    };
    if (p.required) def.$required = true;
    if (p.description) def.$description = p.description;
    if (p.type === 'enum' && p.values.length > 0) def.$values = p.values;
    if (p.type === 'token' && p.tokenKind) def['$token.kind'] = p.tokenKind;
    // $default — gated per type so e.g. boolean props don't get string defaults.
    // Empty string == unset for text-typed defaults. richtext/media/link don't
    // emit a default (defaults aren't meaningful for those types).
    if (p.default !== null) {
      if (p.type === 'boolean' && typeof p.default === 'boolean') {
        def.$default = p.default;
      } else if (
        (p.type === 'string' || p.type === 'token' || p.type === 'enum') &&
        typeof p.default === 'string' &&
        p.default !== ''
      ) {
        def.$default = p.default;
      }
    }
    $properties[p.name] = def;
  }

  const entry: CDFComponentEntry = {
    $type: 'component',
    $properties,
  };
  if (state.componentDescription) entry.$description = state.componentDescription;
  if (state.slots.length > 0) {
    entry.$slots = {};
    for (const s of state.slots) {
      const slotDef: CDFSlotDefinition = {};
      if (s.description) slotDef.$description = s.description;
      if (s.required) slotDef.$required = true;
      if (s.allowedComponents.length > 0) slotDef.$allowedComponents = s.allowedComponents;
      entry.$slots[s.name] = slotDef;
    }
  }

  if (wrapperKey) {
    return JSON.stringify({ [wrapperKey]: entry }, null, 2);
  }
  return JSON.stringify(entry, null, 2);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Picker({ value, active }: { value: string; active: boolean }): React.ReactElement {
  return (
    <Box>
      {active && <Text color="cyan">{'‹'}</Text>}
      <Text color={active ? 'cyan' : 'white'} bold={active}>
        {value}
      </Text>
      {active && <Text color="cyan">{'›'}</Text>}
    </Box>
  );
}

function Toggle({ value, active }: { value: boolean; active: boolean }): React.ReactElement {
  return (
    <Box>
      <Text color={active ? 'cyan' : value ? 'green' : undefined}>{value ? '[✓]' : '[ ]'}</Text>
    </Box>
  );
}

function DefaultSubRow({
  prop,
  active,
  textCursor,
  cursorVisible,
}: {
  prop: PropState;
  active: boolean;
  textCursor: number;
  cursorVisible: boolean;
}): React.ReactElement {
  const cursor = cursorVisible ? '█' : ' ';
  // richtext/media/link don't support defaults — render an inert dim line.
  if (prop.type === 'richtext' || prop.type === 'media' || prop.type === 'link') {
    return (
      <Box paddingLeft={2} gap={1}>
        <Text dimColor>default:</Text>
        <Text dimColor>(not applicable)</Text>
      </Box>
    );
  }

  // boolean — tri-state picker: true | false | (unset).
  if (prop.type === 'boolean') {
    const display =
      prop.default === true ? 'true' : prop.default === false ? 'false' : '(unset)';
    return (
      <Box paddingLeft={2} gap={1}>
        <Text dimColor>default:</Text>
        {active ? <Picker value={display} active={true} /> : <Text color="white">{display}</Text>}
      </Box>
    );
  }

  // enum — picker over prop.values plus (unset).
  if (prop.type === 'enum') {
    if (prop.values.length === 0) {
      return (
        <Box paddingLeft={2} gap={1}>
          <Text dimColor>default:</Text>
          <Text dimColor>(no values defined)</Text>
        </Box>
      );
    }
    const display = typeof prop.default === 'string' && prop.default !== '' ? prop.default : '(unset)';
    return (
      <Box paddingLeft={2} gap={1}>
        <Text dimColor>default:</Text>
        {active ? <Picker value={display} active={true} /> : <Text color="white">{display}</Text>}
      </Box>
    );
  }

  // string / number / token — text input. Active state shows bordered cyan
  // box analogous to the description editor.
  const value = typeof prop.default === 'string' ? prop.default : '';
  if (active) {
    return (
      <Box paddingLeft={2} flexDirection="row">
        <Text dimColor>default:</Text>
        <Box flexGrow={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          <Text>{value.slice(0, textCursor)}</Text>
          <Text inverse={cursorVisible}>{value[textCursor] ?? cursor}</Text>
          <Text>{value.slice(textCursor + 1)}</Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box paddingLeft={2} gap={1}>
      <Text dimColor>default:</Text>
      <Text color={value ? 'white' : undefined} dimColor={!value}>
        {value || '(none)'}
      </Text>
    </Box>
  );
}

function PropRow({
  prop,
  selected,
  activeField,
  textCursor,
  valueCursor,
  cursorVisible,
  editingValue,
  valueText,
  width,
  rationale,
  rowKey,
}: {
  prop: PropState;
  selected: boolean;
  activeField: PropField | null;
  textCursor: number;
  valueCursor: number;
  cursorVisible: boolean;
  editingValue: { mode: 'add' | 'edit'; index?: number } | null;
  valueText: string;
  width: number;
  /** Feature 1: LLM rationale rendered inline below the description. */
  rationale?: string | null;
  /** Feature 1: stable key fragment used for the rationale React key. */
  rowKey?: string;
}): React.ReactElement {
  const cursor = cursorVisible ? '█' : ' ';
  const bg = selected ? 'blue' : undefined;
  const descActive = activeField === 'description';

  // Name column — fixed 14 chars
  const nameDisplay = prop.name.length > 14 ? prop.name.slice(0, 13) + '…' : prop.name.padEnd(14);

  return (
    <Box flexDirection="column" width={width}>
      {/* Main row */}
      <Box gap={1}>
        <Text color={selected ? 'white' : 'cyan'} bold={selected} backgroundColor={bg}>
          {' '}
          {nameDisplay}{' '}
        </Text>

        {/* $type */}
        <Text dimColor={!selected}>type:</Text>
        {activeField === 'type' ? (
          <Picker value={prop.type} active={true} />
        ) : (
          <Text color={selected ? 'yellow' : 'white'}>{prop.type}</Text>
        )}

        {/* $category */}
        <Text dimColor={!selected}>cat:</Text>
        {activeField === 'category' ? (
          <Picker value={prop.category} active={true} />
        ) : (
          <Text color={selected ? 'magenta' : 'white'}>{prop.category}</Text>
        )}

        {/* $required */}
        <Text dimColor={!selected}>req:</Text>
        {activeField === 'required' ? (
          <Toggle value={prop.required} active={true} />
        ) : (
          <Toggle value={prop.required} active={false} />
        )}

        {/* $token.kind — only when type=token */}
        {prop.type === 'token' && (
          <>
            <Text dimColor={!selected}>kind:</Text>
            {activeField === 'tokenKind' ? (
              <Picker value={prop.tokenKind || DESIGN_TOKEN_TYPES[0]} active={true} />
            ) : (
              <Text color={selected ? 'green' : 'white'}>{prop.tokenKind || '—'}</Text>
            )}
          </>
        )}
      </Box>

      {/* $default sub-row — only when selected and type supports defaults.
          richtext/media/link types render `(not applicable)` and skip the
          field cycle (per spec D1). Active state highlights the value with
          cyan; for boolean/enum the picker affordance shows; for string/
          number/token a bordered cyan textbox mirrors the description input. */}
      {selected && (
        <DefaultSubRow
          prop={prop}
          active={activeField === 'default'}
          textCursor={textCursor}
          cursorVisible={cursorVisible}
        />
      )}

      {/* $description sub-row — only when selected. Active state shows a
          bordered box to make the editing target visible. */}
      {selected && descActive && (
        <Box paddingLeft={2} flexDirection="row">
          <Text dimColor>desc:</Text>
          <Box flexGrow={1} borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text>{prop.description.slice(0, textCursor)}</Text>
            <Text inverse={cursorVisible}>{prop.description[textCursor] ?? cursor}</Text>
            <Text>{prop.description.slice(textCursor + 1)}</Text>
          </Box>
        </Box>
      )}
      {selected && !descActive && (
        <Box paddingLeft={2} gap={1}>
          <Text dimColor>desc:</Text>
          <Text color="green">{prop.description || '—'}</Text>
        </Box>
      )}

      {/* Feature 1: LLM rationale — rendered inline below description, dim,
          non-navigable. Truncated at width − 8 chars. Always visible (no key).
          The rationale is the LLM's internal reasoning slot; description above
          remains the customer-facing copy. */}
      {selected && rationale && rationale.trim().length > 0 && (
        <Box paddingLeft={2} key={rowKey ? `rationale-${rowKey}` : undefined}>
          <Text dimColor>
            {(() => {
              const max = Math.max(8, width - 8);
              const text = `~ ${rationale}`;
              return text.length > max ? text.slice(0, max - 1) + '…' : text;
            })()}
          </Text>
        </Box>
      )}

      {/* $values sub-list — only when selected and type=enum */}
      {selected && prop.type === 'enum' && (
        <Box paddingLeft={2} flexDirection="column">
          <Box>
            <Text dimColor>values:</Text>
            {activeField === 'values' && (
              <Text dimColor>{'  [a]dd  [e]dit  [r]emove  [↑↓] navigate  [K/J] reorder'}</Text>
            )}
          </Box>
          {prop.values.length === 0 && !editingValue && <Text dimColor> (none — press [a] to add)</Text>}
          {prop.values.map((v, i) => {
            const isActiveCursor = activeField === 'values' && valueCursor === i;
            const isBeingEdited = editingValue?.mode === 'edit' && editingValue.index === i;
            if (isBeingEdited) {
              return (
                <Box key={i} paddingLeft={2}>
                  <Text color="cyan">{'✎ '}</Text>
                  <Text>{valueText}</Text>
                  <Text inverse={cursorVisible}> </Text>
                </Box>
              );
            }
            return (
              <Box key={i} gap={1} paddingLeft={2}>
                <Text color={isActiveCursor ? 'cyan' : 'white'}>{isActiveCursor ? `▶ ${v}` : `  ${v}`}</Text>
              </Box>
            );
          })}
          {editingValue?.mode === 'add' && (
            <Box paddingLeft={2}>
              <Text color="cyan">{'+ '}</Text>
              <Text>{valueText}</Text>
              <Text inverse={cursorVisible}> </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

function SlotRow({
  slot,
  selected,
  activeField,
  textCursor,
  valueCursor,
  cursorVisible,
  editingValue,
  valueText,
  width,
}: {
  slot: SlotState;
  selected: boolean;
  activeField: SlotField | null;
  textCursor: number;
  valueCursor: number;
  cursorVisible: boolean;
  editingValue: { mode: 'add' | 'edit'; index?: number } | null;
  valueText: string;
  width: number;
}): React.ReactElement {
  const cursor = cursorVisible ? '█' : ' ';
  const bg = selected ? 'blue' : undefined;
  const nameDisplay = slot.name.length > 14 ? slot.name.slice(0, 13) + '…' : slot.name.padEnd(14);

  return (
    <Box flexDirection="column" width={width}>
      <Box gap={1}>
        <Text color={selected ? 'white' : 'cyan'} bold={selected} backgroundColor={bg}>
          {' '}
          {nameDisplay}{' '}
        </Text>
        <Text dimColor={!selected}>req:</Text>
        {activeField === 'required' ? (
          <Toggle value={slot.required} active={true} />
        ) : (
          <Toggle value={slot.required} active={false} />
        )}
      </Box>

      {/* $allowedComponents sub-list — mirrors enum $values UX. Empty list
          renders as `(any)` in dim text. */}
      {selected && (
        <Box paddingLeft={2} flexDirection="column">
          <Box>
            <Text dimColor>allowed:</Text>
            {activeField === 'allowedComponents' && (
              <Text dimColor>{'  [a]dd  [e]dit  [r]emove  [↑↓] navigate  [K/J] reorder'}</Text>
            )}
          </Box>
          {slot.allowedComponents.length === 0 && !editingValue && (
            <Box paddingLeft={2}>
              <Text dimColor>{activeField === 'allowedComponents' ? '(any — press [a] to add)' : '(any)'}</Text>
            </Box>
          )}
          {slot.allowedComponents.map((v, i) => {
            const isActiveCursor = activeField === 'allowedComponents' && valueCursor === i;
            const isBeingEdited = editingValue?.mode === 'edit' && editingValue.index === i;
            if (isBeingEdited) {
              return (
                <Box key={i} paddingLeft={2}>
                  <Text color="cyan">{'✎ '}</Text>
                  <Text>{valueText}</Text>
                  <Text inverse={cursorVisible}> </Text>
                </Box>
              );
            }
            return (
              <Box key={i} gap={1} paddingLeft={2}>
                <Text color={isActiveCursor ? 'cyan' : 'white'}>{isActiveCursor ? `▶ ${v}` : `  ${v}`}</Text>
              </Box>
            );
          })}
          {editingValue?.mode === 'add' && activeField === 'allowedComponents' && (
            <Box paddingLeft={2}>
              <Text color="cyan">{'+ '}</Text>
              <Text>{valueText}</Text>
              <Text inverse={cursorVisible}> </Text>
            </Box>
          )}
        </Box>
      )}

      {selected && activeField === 'description' && (
        <Box paddingLeft={2} flexDirection="row">
          <Text dimColor>desc:</Text>
          <Box flexGrow={1} borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text>{slot.description.slice(0, textCursor)}</Text>
            <Text inverse={cursorVisible}>{slot.description[textCursor] ?? cursor}</Text>
            <Text>{slot.description.slice(textCursor + 1)}</Text>
          </Box>
        </Box>
      )}
      {selected && activeField !== 'description' && (
        <Box paddingLeft={2} gap={1}>
          <Text dimColor>desc:</Text>
          <Text color="green">{slot.description || '—'}</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Field navigation types ─────────────────────────────────────────────────

type PropField = 'type' | 'category' | 'required' | 'description' | 'tokenKind' | 'values' | 'default';
type SlotField = 'required' | 'description' | 'allowedComponents';

// Field order is intentional: description is LAST so it's the "edge" of the
// field cycle. The user reaches description by walking through type → category
// → required → [tokenKind?] → [values?] → [default?] → description via j/k;
// once active, description swallows j/k as literal text input. Putting it last
// means the user has to deliberately navigate to it, avoiding accidental
// text-entry. `default` slots in BEFORE description for the same reason —
// description-as-last is invariant. richtext/media/link omit `default` because
// defaults aren't meaningful for those types (per spec D1).
function propFields(prop: PropState): PropField[] {
  const fields: PropField[] = ['type', 'category', 'required'];
  if (prop.type === 'token') fields.push('tokenKind');
  if (prop.type === 'enum') fields.push('values');
  if (prop.type !== 'richtext' && prop.type !== 'media' && prop.type !== 'link') {
    fields.push('default');
  }
  fields.push('description');
  return fields;
}
// Slot fields: description stays last for the same invariant reason. Allowed-
// components is a list-typed field that swallows j/k similarly to enum $values
// — placing it before description preserves description-as-last.
const SLOT_FIELDS: SlotField[] = ['required', 'allowedComponents', 'description'];

// ── Main component ────────────────────────────────────────────────────────────

export function FieldEditor({
  value,
  width,
  height,
  active = true,
  onChange,
  onSave,
  onDiscard,
  onExit,
  metadata,
}: FieldEditorProps): React.ReactElement {
  const { state: initialState, error: parseError } = parseToState(value);

  const [editorState, setEditorState] = useState<EditorState>(initialState);
  const [parseErr] = useState<string | null>(parseError);

  // Navigation state — initial state lands at the row level with NO field
  // auto-active. The user presses Return to enter field-edit at the first
  // field of the row (type), then j/k to walk through fields uniformly:
  // type → category → required → [tokenKind?] → [values?] → description.
  // Description is reached via navigation, not auto-focus — this avoids
  // trapping the user in description-edit (where j/k type literals).
  const initialFocus = (() => {
    if (initialState.props.length > 0) {
      return {
        focusLevel: 'prop' as FocusLevel,
        inSlots: false,
        activeField: null as PropField | SlotField | null,
        textCursor: 0,
      };
    }
    if (initialState.slots.length > 0) {
      return {
        focusLevel: 'slot' as FocusLevel,
        inSlots: true,
        activeField: null as PropField | SlotField | null,
        textCursor: 0,
      };
    }
    return {
      focusLevel: 'prop' as FocusLevel,
      inSlots: false,
      activeField: null as PropField | SlotField | null,
      textCursor: 0,
    };
  })();

  const [focusLevel, setFocusLevel] = useState<FocusLevel>(initialFocus.focusLevel);
  const [propIdx, setPropIdx] = useState(0);
  const [slotIdx, setSlotIdx] = useState(0);
  // Whether we're navigating props (false) or slots (true) at the top level
  const [inSlots, setInSlots] = useState(initialFocus.inSlots);
  // True when the active focus is the component-level $description row (rather
  // than a prop/slot row). Lives parallel to inSlots — they're mutually exclusive.
  const [inComponentDesc, setInComponentDesc] = useState(false);
  // Active field within a prop/slot
  const [activeField, setActiveField] = useState<PropField | SlotField | null>(initialFocus.activeField);
  // Text cursor position for description fields
  const [textCursor, setTextCursor] = useState(initialFocus.textCursor);
  // Value list cursor for $values editing
  const [valueCursor, setValueCursor] = useState(0);
  // Inline text-entry mode for adding/editing a $values entry.
  // mode='add' — append on Enter; mode='edit' — replace at index on Enter.
  const [editingValue, setEditingValue] = useState<{ mode: 'add' | 'edit'; index?: number } | null>(null);
  const [valueText, setValueText] = useState('');

  const [validationError, setValidationError] = useState<string | null>(null);
  const [cursorVisible] = useState(true);

  // Feature 1: source-view panel toggle. Opens with `s`, closes with `s` or Esc.
  // When open, Esc closes the panel only (does not bubble to onExit).
  const [sourceOpen, setSourceOpen] = useState(false);

  const props = editorState.props;
  const slots = editorState.slots;

  const currentProp = props[propIdx] ?? null;
  const currentSlot = slots[slotIdx] ?? null;

  // Emit serialized JSON whenever state changes
  const commit = (next: EditorState) => {
    setEditorState(next);
    onChange(serializeState(next, value));
  };

  useImmediateInput((input, key) => {
    if (!active) return;

    // ── Inline value text-entry (add or edit) ─ highest priority ───────────
    // Handles enum prop $values AND slot $allowedComponents — both use the
    // same add/edit/remove/reorder list shape.
    const isPropValuesEntry = editingValue && currentProp && activeField === 'values' && !inSlots;
    const isSlotAllowedEntry = editingValue && currentSlot && activeField === 'allowedComponents' && inSlots;
    if (isPropValuesEntry || isSlotAllowedEntry) {
      const vals = isPropValuesEntry ? currentProp!.values : currentSlot!.allowedComponents;
      if (key.return) {
        const trimmed = valueText.trim();
        if (trimmed) {
          let nextVals: string[];
          let cursorAfter: number;
          if (editingValue!.mode === 'add') {
            nextVals = [...vals, trimmed];
            cursorAfter = nextVals.length - 1;
          } else {
            const idx = editingValue!.index ?? 0;
            nextVals = vals.map((v, i) => (i === idx ? trimmed : v));
            cursorAfter = idx;
          }
          if (isPropValuesEntry) {
            const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: nextVals } : p));
            commit({ ...editorState, props: nextProps });
          } else {
            const nextSlots = slots.map((s, i) => (i === slotIdx ? { ...s, allowedComponents: nextVals } : s));
            commit({ ...editorState, slots: nextSlots });
          }
          setValueCursor(cursorAfter);
        }
        setEditingValue(null);
        setValueText('');
        return;
      }
      if (key.escape) {
        setEditingValue(null);
        setValueText('');
        return;
      }
      if (key.backspace) {
        setValueText((t) => t.slice(0, -1));
        return;
      }
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setValueText((t) => t + input);
        return;
      }
      return;
    }

    // ── Save / Discard ───────────────────────────────────────────────────────
    if (key.ctrl && input === 's') {
      setValidationError(null);
      onSave();
      return;
    }

    // ── Feature 1: source-view panel toggle ─────────────────────────────────
    // `s` (without Ctrl) opens/closes the source-view panel. Skip when in
    // inline text-entry contexts (description text-entry, value-list edit).
    // Description text-entry is gated by focusLevel === 'field' && activeField
    // === 'description' — we guard against typing 's' as a literal there.
    const inDescriptionTextEntry =
      focusLevel === 'field' && (activeField === 'description');
    const inComponentDescTextEntry =
      focusLevel === 'field' && inComponentDesc && (activeField === 'description');
    if (
      input === 's' &&
      !key.ctrl &&
      !key.meta &&
      !inDescriptionTextEntry &&
      !inComponentDescTextEntry
    ) {
      setSourceOpen((o) => !o);
      return;
    }

    // ── Esc when source panel is open: close panel only, do not bubble ─────
    if (key.escape && sourceOpen) {
      setSourceOpen(false);
      return;
    }

    if (key.escape) {
      if (focusLevel === 'field') {
        // Exit field editing back to prop/slot/component-description row level
        if (inComponentDesc) setFocusLevel('componentDescription');
        else setFocusLevel(inSlots ? 'slot' : 'prop');
        setActiveField(null);
        return;
      }
      // Row-level Esc: bounce focus back out of the panel via onExit.
      // Falls back to onDiscard when the caller hasn't wired onExit.
      if (onExit) {
        onExit();
      } else {
        onDiscard();
      }
      return;
    }

    // ── Prop-level navigation (not inside a field) ───────────────────────────
    // Arrows / j / k move between rows. Return enters field-edit at the FIRST
    // field of the current prop (type). No auto-focus on description.
    if (focusLevel === 'prop') {
      if (key.upArrow || input === 'k') {
        if (propIdx > 0) {
          setPropIdx(propIdx - 1);
        } else {
          // From prop[0], k enters the component-description row above.
          setFocusLevel('componentDescription');
          setInSlots(false);
          setInComponentDesc(true);
        }
        return;
      }
      if (key.downArrow || input === 'j') {
        if (propIdx < props.length - 1) {
          setPropIdx(propIdx + 1);
        } else if (slots.length > 0) {
          setInSlots(true);
          setSlotIdx(0);
          setFocusLevel('slot');
        }
        return;
      }
      if (key.return && currentProp) {
        // Enter field editing on the first field of this prop (type).
        setFocusLevel('field');
        setActiveField(propFields(currentProp)[0] ?? null);
        setTextCursor(currentProp.description.length);
        return;
      }
      return;
    }

    // ── Component-description row navigation ─────────────────────────────────
    if (focusLevel === 'componentDescription') {
      if (key.upArrow || input === 'k') {
        // Already at the top-most row — stay put.
        return;
      }
      if (key.downArrow || input === 'j') {
        // Move down into the first prop row, or first slot row when no props.
        if (props.length > 0) {
          setFocusLevel('prop');
          setPropIdx(0);
          setInSlots(false);
          setInComponentDesc(false);
        } else if (slots.length > 0) {
          setFocusLevel('slot');
          setSlotIdx(0);
          setInSlots(true);
          setInComponentDesc(false);
        }
        return;
      }
      if (key.return) {
        // Enter the single field — description text input.
        setFocusLevel('field');
        setActiveField('description');
        setTextCursor(editorState.componentDescription.length);
        return;
      }
      return;
    }

    // ── Slot-level navigation ────────────────────────────────────────────────
    // Arrows / j / k move between rows. Return enters field-edit at the FIRST
    // field of the slot (required). No auto-focus on description.
    if (focusLevel === 'slot') {
      if (key.upArrow || input === 'k') {
        if (slotIdx > 0) {
          setSlotIdx(slotIdx - 1);
        } else if (props.length > 0) {
          setInSlots(false);
          setPropIdx(props.length - 1);
          setFocusLevel('prop');
        }
        return;
      }
      if (key.downArrow || input === 'j') {
        if (slotIdx < slots.length - 1) {
          setSlotIdx(slotIdx + 1);
        }
        return;
      }
      if (key.return && currentSlot) {
        setFocusLevel('field');
        setActiveField(SLOT_FIELDS[0] ?? null);
        setTextCursor(currentSlot.description.length);
        return;
      }
      return;
    }

    // ── Field-level navigation (inside a prop/slot, selecting which field) ───
    if (focusLevel === 'field') {
      const fields = inSlots ? SLOT_FIELDS : currentProp ? propFields(currentProp) : [];
      const currentFieldIdx = fields.indexOf(activeField as never);
      const isDescriptionTextEntry = activeField === 'description';
      // String/token defaults are also text-entry; j/k must type literals
      // there too (consistency with description). boolean/enum defaults use
      // ←/→ pickers so j/k can keep cycling fields.
      const isDefaultTextEntry =
        activeField === 'default' &&
        currentProp != null &&
        (currentProp.type === 'string' || currentProp.type === 'token');
      const isValuesNav = activeField === 'values' || activeField === 'allowedComponents';
      const arrowUp = key.upArrow;
      const arrowDown = key.downArrow;

      // ── Inside values: arrow keys AND j/k navigate BETWEEN VALUES, not
      //    between fields. Reorder is K/J (capital). Same logic for prop
      //    enum $values and slot $allowedComponents.
      if (isValuesNav) {
        const vals =
          activeField === 'values' && currentProp
            ? currentProp.values
            : activeField === 'allowedComponents' && currentSlot
              ? currentSlot.allowedComponents
              : null;
        if (vals !== null) {
          if (arrowUp || input === 'k') {
            setValueCursor((c) => Math.max(0, c - 1));
            return;
          }
          if (arrowDown || input === 'j') {
            setValueCursor((c) => Math.max(0, Math.min(vals.length - 1, c + 1)));
            return;
          }
        }
      }

      // ── Field cycling within the current prop/slot.
      //    Arrows always cycle (including from description, which means in
      //    description-active state arrows leave text-entry to navigate fields
      //    of the SAME prop). j/k only cycle when NOT in description, so that
      //    description preserves literal text-entry for those characters. Use
      //    Esc to leave the current prop and return to row-level navigation.
      if (!isValuesNav) {
        const navUp = arrowUp || (!isDescriptionTextEntry && !isDefaultTextEntry && input === 'k');
        const navDown = arrowDown || (!isDescriptionTextEntry && !isDefaultTextEntry && input === 'j');
        if ((navUp || navDown) && fields.length > 0) {
          const lastIdx = fields.length - 1;
          const targetIdx = navDown
            ? currentFieldIdx >= lastIdx
              ? 0
              : currentFieldIdx + 1
            : currentFieldIdx <= 0
              ? lastIdx
              : currentFieldIdx - 1;
          const next = fields[targetIdx] as PropField | SlotField;
          setActiveField(next);
          if (next === 'description') {
            const desc = inSlots ? (currentSlot?.description ?? '') : (currentProp?.description ?? '');
            setTextCursor(desc.length);
          } else if (next === 'default' && currentProp) {
            // Land cursor at end of any string-typed default for ergonomic typing.
            const cur = typeof currentProp.default === 'string' ? currentProp.default : '';
            setTextCursor(cur.length);
          }
          return;
        }
      }

      // ── Picker fields (left/right cycle) ──────────────────────────────────
      if (activeField === 'type' && (key.leftArrow || key.rightArrow) && currentProp) {
        const options = CDF_PROPERTY_TYPES as readonly string[];
        const idx = options.indexOf(currentProp.type);
        const next = key.leftArrow
          ? options[(idx - 1 + options.length) % options.length]
          : options[(idx + 1) % options.length];
        const updated = { ...currentProp, type: next as PropState['type'] };
        // Clear token/enum specific fields when switching away
        if (next !== 'token') updated.tokenKind = '';
        if (next !== 'enum') updated.values = [];
        const nextProps = props.map((p, i) => (i === propIdx ? updated : p));
        commit({ ...editorState, props: nextProps });
        return;
      }

      if (activeField === 'category' && (key.leftArrow || key.rightArrow) && currentProp) {
        const options = CDF_PROPERTY_CATEGORIES as readonly string[];
        const idx = options.indexOf(currentProp.category);
        const next = key.leftArrow
          ? options[(idx - 1 + options.length) % options.length]
          : options[(idx + 1) % options.length];
        const nextProps = props.map((p, i) => (i === propIdx ? { ...p, category: next as PropState['category'] } : p));
        commit({ ...editorState, props: nextProps });
        return;
      }

      if (activeField === 'tokenKind' && (key.leftArrow || key.rightArrow) && currentProp) {
        const options = DESIGN_TOKEN_TYPES as readonly string[];
        const cur = currentProp.tokenKind || options[0];
        const idx = options.indexOf(cur);
        const next = key.leftArrow
          ? options[(idx - 1 + options.length) % options.length]
          : options[(idx + 1) % options.length];
        const nextProps = props.map((p, i) => (i === propIdx ? { ...p, tokenKind: next } : p));
        commit({ ...editorState, props: nextProps });
        return;
      }

      // ── Toggle fields (space/enter) ────────────────────────────────────────
      if (activeField === 'required' && (key.return || input === ' ')) {
        if (inSlots && currentSlot) {
          const nextSlots = slots.map((s, i) => (i === slotIdx ? { ...s, required: !s.required } : s));
          commit({ ...editorState, slots: nextSlots });
        } else if (currentProp) {
          const nextProps = props.map((p, i) => (i === propIdx ? { ...p, required: !p.required } : p));
          commit({ ...editorState, props: nextProps });
        }
        return;
      }

      // ── $default editing per type ─────────────────────────────────────────
      if (activeField === 'default' && currentProp) {
        const setProp = (next: PropState) => {
          const nextProps = props.map((p, i) => (i === propIdx ? next : p));
          commit({ ...editorState, props: nextProps });
        };

        // boolean: tri-state cycle (unset → true → false → unset).
        if (currentProp.type === 'boolean' && (key.leftArrow || key.rightArrow)) {
          const cycle: (boolean | null)[] = [null, true, false];
          const curIdx = cycle.findIndex((v) => v === currentProp.default);
          const idx = curIdx < 0 ? 0 : curIdx;
          const nextIdx = key.rightArrow
            ? (idx + 1) % cycle.length
            : (idx - 1 + cycle.length) % cycle.length;
          setProp({ ...currentProp, default: cycle[nextIdx]! });
          return;
        }

        // enum: cycle through prop.values plus (unset).
        if (currentProp.type === 'enum' && (key.leftArrow || key.rightArrow)) {
          const opts: (string | null)[] = [null, ...currentProp.values];
          const cur = typeof currentProp.default === 'string' ? currentProp.default : null;
          const curIdx = opts.findIndex((v) => v === cur);
          const idx = curIdx < 0 ? 0 : curIdx;
          const nextIdx = key.rightArrow
            ? (idx + 1) % opts.length
            : (idx - 1 + opts.length) % opts.length;
          setProp({ ...currentProp, default: opts[nextIdx] });
          return;
        }

        // string/token: text input. Mirrors description input subroutine.
        if (currentProp.type === 'string' || currentProp.type === 'token') {
          const cur = typeof currentProp.default === 'string' ? currentProp.default : '';
          const setVal = (next: string) => setProp({ ...currentProp, default: next === '' ? null : next });
          if (key.leftArrow) {
            setTextCursor((c) => Math.max(0, c - 1));
            return;
          }
          if (key.rightArrow) {
            setTextCursor((c) => Math.min(cur.length, c + 1));
            return;
          }
          if (key.backspace) {
            if (textCursor > 0) {
              setVal(cur.slice(0, textCursor - 1) + cur.slice(textCursor));
              setTextCursor((c) => c - 1);
            }
            return;
          }
          if (key.delete) {
            if (textCursor < cur.length) setVal(cur.slice(0, textCursor) + cur.slice(textCursor + 1));
            return;
          }
          if (input && input.length === 1 && !key.ctrl && !key.meta && !key.return) {
            setVal(cur.slice(0, textCursor) + input + cur.slice(textCursor));
            setTextCursor((c) => c + 1);
            return;
          }
          return;
        }
        return;
      }

      // ── Description text input ─────────────────────────────────────────────
      if (activeField === 'description') {
        const getDesc = () =>
          inComponentDesc
            ? editorState.componentDescription
            : inSlots
              ? (currentSlot?.description ?? '')
              : (currentProp?.description ?? '');
        const setDesc = (next: string) => {
          if (inComponentDesc) {
            commit({ ...editorState, componentDescription: next });
          } else if (inSlots && currentSlot) {
            const nextSlots = slots.map((s, i) => (i === slotIdx ? { ...s, description: next } : s));
            commit({ ...editorState, slots: nextSlots });
          } else if (currentProp) {
            const nextProps = props.map((p, i) => (i === propIdx ? { ...p, description: next } : p));
            commit({ ...editorState, props: nextProps });
          }
        };
        const desc = getDesc();

        if (key.leftArrow) {
          setTextCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.rightArrow) {
          setTextCursor((c) => Math.min(desc.length, c + 1));
          return;
        }
        if (input === '\x1b[H' || input === '\x1b[1~') {
          setTextCursor(0);
          return;
        }
        if (input === '\x1b[F' || input === '\x1b[4~') {
          setTextCursor(desc.length);
          return;
        }
        if (key.backspace) {
          if (textCursor > 0) {
            setDesc(desc.slice(0, textCursor - 1) + desc.slice(textCursor));
            setTextCursor((c) => c - 1);
          }
          return;
        }
        if (key.delete) {
          if (textCursor < desc.length) setDesc(desc.slice(0, textCursor) + desc.slice(textCursor + 1));
          return;
        }
        if (input && input.length === 1 && !key.ctrl && !key.meta && !key.return) {
          setDesc(desc.slice(0, textCursor) + input + desc.slice(textCursor));
          setTextCursor((c) => c + 1);
          return;
        }
        return;
      }

      // ── $allowedComponents inline manipulation (slot-level) ──────────────
      // Mirrors the $values block exactly, but operates on the slot's
      // allowedComponents list.
      if (activeField === 'allowedComponents' && currentSlot) {
        const vals = currentSlot.allowedComponents;
        const setSlotVals = (next: string[]) => {
          const nextSlots = slots.map((s, i) => (i === slotIdx ? { ...s, allowedComponents: next } : s));
          commit({ ...editorState, slots: nextSlots });
        };
        if (input === 'a') {
          setEditingValue({ mode: 'add' });
          setValueText('');
          return;
        }
        if (input === 'e' && vals.length > 0) {
          setEditingValue({ mode: 'edit', index: valueCursor });
          setValueText(vals[valueCursor] ?? '');
          return;
        }
        if (input === 'r' && vals.length > 0) {
          const nextVals = vals.filter((_, i) => i !== valueCursor);
          setSlotVals(nextVals);
          setValueCursor((c) => Math.max(0, Math.min(c, nextVals.length - 1)));
          return;
        }
        if (input === 'K' && valueCursor > 0) {
          const nextVals = [...vals];
          [nextVals[valueCursor - 1], nextVals[valueCursor]] = [nextVals[valueCursor], nextVals[valueCursor - 1]];
          setSlotVals(nextVals);
          setValueCursor((c) => c - 1);
          return;
        }
        if (input === 'J' && valueCursor < vals.length - 1) {
          const nextVals = [...vals];
          [nextVals[valueCursor], nextVals[valueCursor + 1]] = [nextVals[valueCursor + 1], nextVals[valueCursor]];
          setSlotVals(nextVals);
          setValueCursor((c) => c + 1);
          return;
        }
        return;
      }

      // ── $values inline manipulation (flat — no extra Return) ───────────────
      if (activeField === 'values' && currentProp) {
        const vals = currentProp.values;

        // a — add new value (inline text-entry)
        if (input === 'a') {
          setEditingValue({ mode: 'add' });
          setValueText('');
          return;
        }

        // e — edit value at cursor (inline text-entry, pre-filled)
        if (input === 'e' && vals.length > 0) {
          setEditingValue({ mode: 'edit', index: valueCursor });
          setValueText(vals[valueCursor] ?? '');
          return;
        }

        // r — remove value at cursor
        if (input === 'r' && vals.length > 0) {
          const nextVals = vals.filter((_, i) => i !== valueCursor);
          const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: nextVals } : p));
          commit({ ...editorState, props: nextProps });
          setValueCursor((c) => Math.max(0, Math.min(c, nextVals.length - 1)));
          return;
        }

        // K (Shift+K) — move value up
        if (input === 'K' && valueCursor > 0) {
          const nextVals = [...vals];
          [nextVals[valueCursor - 1], nextVals[valueCursor]] = [nextVals[valueCursor], nextVals[valueCursor - 1]];
          const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: nextVals } : p));
          commit({ ...editorState, props: nextProps });
          setValueCursor((c) => c - 1);
          return;
        }

        // J (Shift+J) — move value down
        if (input === 'J' && valueCursor < vals.length - 1) {
          const nextVals = [...vals];
          [nextVals[valueCursor], nextVals[valueCursor + 1]] = [nextVals[valueCursor + 1], nextVals[valueCursor]];
          const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: nextVals } : p));
          commit({ ...editorState, props: nextProps });
          setValueCursor((c) => c + 1);
          return;
        }
        return;
      }

      return;
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  const innerWidth = Math.max(1, width - 2);

  if (parseErr) {
    return (
      <Box flexDirection="column" width={width} borderStyle="single" borderColor="red">
        <Text bold color="red">
          FIELD EDITOR — parse error
        </Text>
        <Text color="red">{parseErr}</Text>
        <Text dimColor>Cannot display structured editor. Fix the JSON first.</Text>
      </Box>
    );
  }

  if (props.length === 0 && slots.length === 0) {
    return (
      <Box flexDirection="column" width={width} borderStyle="single" borderColor="yellow">
        <Text bold color="yellow">FIELD EDITOR — no fields</Text>
        <Text color="yellow">
          {'⚠ No properties classified for this component. The LLM didn\'t find anything to classify.'}
        </Text>
        <Text dimColor>You can add fields manually below or reject this component.</Text>
        <Text dimColor>Ctrl+S to save · Esc to discard</Text>
      </Box>
    );
  }

  // When $properties is empty but $slots exist, surface the same warning
  // prominently in the panel so the user understands why the component looks
  // sparse — and can act on it (manually add a prop or reject).
  const hasEmptyProperties = props.length === 0;

  const modeLabel = (() => {
    if (editingValue) {
      return editingValue.mode === 'add' ? 'Enter to add · Esc to cancel' : 'Enter to save edit · Esc to cancel';
    }
    if (focusLevel === 'field' && activeField === 'description') {
      return 'Type to edit  ←→ cursor  ↑↓ cycle field  Esc row  Ctrl+S save';
    }
    if (
      focusLevel === 'field' &&
      (activeField === 'type' || activeField === 'category' || activeField === 'tokenKind')
    ) {
      return '←→ cycle value  ↑↓/jk cycle field  Esc row';
    }
    if (focusLevel === 'field' && activeField === 'required') {
      return 'Space/Enter toggle  ↑↓/jk cycle field  Esc row';
    }
    if (focusLevel === 'field' && (activeField === 'values' || activeField === 'allowedComponents')) {
      return '[a]dd  [e]dit  [r]emove  ↑↓/jk navigate  [K/J] reorder  Esc row';
    }
    return '↑↓/jk navigate rows  Enter edit fields  Ctrl+S save  Esc exit panel';
  })();

  // Build visible rows
  type Row =
    | { kind: 'header'; label: string }
    | { kind: 'prop'; idx: number }
    | { kind: 'slot'; idx: number }
    | { kind: 'component-description' };

  const rows: Row[] = [];
  // Component-level $description always renders first so it's reachable as
  // the topmost navigable row, even when empty (the operator can populate it).
  rows.push({ kind: 'component-description' });
  if (props.length > 0) {
    rows.push({ kind: 'header', label: `── $properties (${props.length}) ` });
    props.forEach((_, i) => rows.push({ kind: 'prop', idx: i }));
  }
  if (slots.length > 0) {
    rows.push({ kind: 'header', label: `── $slots (${slots.length}) ` });
    slots.forEach((_, i) => rows.push({ kind: 'slot', idx: i }));
  }

  // Scroll to keep selected row visible
  const selectedRowIdx = rows.findIndex(
    (r) =>
      (r.kind === 'prop' && !inSlots && !inComponentDesc && r.idx === propIdx) ||
      (r.kind === 'slot' && inSlots && r.idx === slotIdx) ||
      (r.kind === 'component-description' && inComponentDesc),
  );
  const visibleRows = Math.max(1, height - 3); // title + hint bar + border
  const scrollStart = selectedRowIdx < 0 ? 0 : Math.max(0, Math.min(selectedRowIdx, rows.length - visibleRows));
  const visibleRowSlice = rows.slice(scrollStart, scrollStart + visibleRows);

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor={hasEmptyProperties ? 'yellow' : 'cyan'}>
      <Text bold color={hasEmptyProperties ? 'yellow' : 'cyan'}>
        {'FIELDS [Ctrl+S save · Esc discard]'}
      </Text>

      {hasEmptyProperties && (
        <Text color="yellow">
          {'⚠ No properties classified for this component. The LLM didn\'t find anything to classify. Reject this component or add fields manually.'}
        </Text>
      )}

      <Box flexDirection="column" width={innerWidth}>
        {visibleRowSlice.map((row, i) => {
          if (row.kind === 'header') {
            return (
              <Text key={`header-${i}`} dimColor>
                {row.label}
              </Text>
            );
          }
          if (row.kind === 'component-description') {
            const isSelected = inComponentDesc;
            const isEditing = isSelected && focusLevel === 'field' && activeField === 'description';
            const desc = editorState.componentDescription;
            return (
              <Box key={`component-description-${i}`} flexDirection="column">
                <Box gap={1}>
                  <Text
                    color={isSelected ? 'white' : 'cyan'}
                    bold={isSelected}
                    backgroundColor={isSelected ? 'blue' : undefined}
                  >
                    {' component-$description '}
                  </Text>
                </Box>
                {isEditing ? (
                  <Box paddingLeft={2} flexDirection="row">
                    <Box flexGrow={1} borderStyle="round" borderColor="cyan" paddingX={1}>
                      <Text>{desc.slice(0, textCursor)}</Text>
                      <Text inverse={cursorVisible}>{desc[textCursor] ?? (cursorVisible ? '█' : ' ')}</Text>
                      <Text>{desc.slice(textCursor + 1)}</Text>
                    </Box>
                  </Box>
                ) : (
                  <Box paddingLeft={2}>
                    <Text color={desc ? 'green' : undefined} dimColor={!desc}>
                      {desc || '(none — Return to edit)'}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          }
          if (row.kind === 'prop') {
            const p = props[row.idx]!;
            const isSelected = !inSlots && !inComponentDesc && row.idx === propIdx;
            const propMeta = metadata?.props?.[p.name];
            return (
              <PropRow
                key={`prop-${row.idx}`}
                prop={p}
                selected={isSelected}
                activeField={isSelected && focusLevel === 'field' ? (activeField as PropField) : null}
                textCursor={textCursor}
                valueCursor={valueCursor}
                cursorVisible={cursorVisible}
                editingValue={isSelected ? editingValue : null}
                valueText={isSelected ? valueText : ''}
                width={innerWidth}
                rationale={propMeta?.rationale ?? null}
                rowKey={String(row.idx)}
              />
            );
          }
          // slot row
          const s = slots[row.idx]!;
          const isSelected = inSlots && row.idx === slotIdx;
          return (
            <SlotRow
              key={`slot-${row.idx}`}
              slot={s}
              selected={isSelected}
              activeField={isSelected && focusLevel === 'field' ? (activeField as SlotField) : null}
              textCursor={textCursor}
              valueCursor={valueCursor}
              cursorVisible={cursorVisible}
              editingValue={isSelected ? editingValue : null}
              valueText={isSelected ? valueText : ''}
              width={innerWidth}
            />
          );
        })}
      </Box>

      {/* Feature 1: source-view panel — toggled by `s`. Slices componentSource
          to the captured per-prop line range; falls back to a friendly notice
          when source location is missing. */}
      {sourceOpen &&
        (() => {
          const propMeta = !inSlots && !inComponentDesc && currentProp ? metadata?.props?.[currentProp.name] : undefined;
          const start = propMeta?.sourceStartLine ?? null;
          const end = propMeta?.sourceEndLine ?? null;
          const path = metadata?.sourcePath ?? null;
          const src = metadata?.componentSource ?? null;
          const headerPath = path ?? '<unknown source path>';
          if (!start || !end || !src) {
            return (
              <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
                <Text dimColor bold>{`source: ${headerPath}`}</Text>
                <Text dimColor>(no source location captured for this prop)</Text>
                <Text dimColor>[s] close</Text>
              </Box>
            );
          }
          const lines = src.split('\n').slice(Math.max(0, start - 1), end);
          return (
            <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
              <Text dimColor bold>{`${headerPath}: lines ${start}–${end}`}</Text>
              {lines.map((ln, i) => (
                <Text key={`source-line-${i}`} dimColor>
                  {ln}
                </Text>
              ))}
              <Text dimColor>[s] close · [Esc] close</Text>
            </Box>
          );
        })()}

      {validationError && <Text color="red">{'✗ ' + validationError}</Text>}
      <Text dimColor>{modeLabel}</Text>
    </Box>
  );
}

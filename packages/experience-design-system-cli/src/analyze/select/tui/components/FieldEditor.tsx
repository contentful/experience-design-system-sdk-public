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
type FocusLevel = 'section' | 'prop' | 'slot' | 'field';

type PropState = {
  name: string;
  type: (typeof CDF_PROPERTY_TYPES)[number];
  category: (typeof CDF_PROPERTY_CATEGORIES)[number];
  required: boolean;
  description: string;
  values: string[];
  tokenKind: string;
};

type SlotState = {
  name: string;
  description: string;
  required: boolean;
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
    return {
      name,
      type: CDF_PROPERTY_TYPES.includes(p.$type as never) ? (p.$type as PropState['type']) : 'string',
      category: CDF_PROPERTY_CATEGORIES.includes(p.$category as never)
        ? (p.$category as PropState['category'])
        : 'content',
      required: p.$required === true,
      description: typeof p.$description === 'string' ? p.$description : '',
      values: Array.isArray(p.$values) ? (p.$values as string[]).filter((v) => typeof v === 'string') : [],
      tokenKind: typeof p['$token.kind'] === 'string' ? p['$token.kind'] : '',
    };
  });

  const rawSlots = (component.$slots ?? {}) as Record<string, unknown>;
  const slots: SlotState[] = Object.entries(rawSlots).map(([name, raw]) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    return {
      name,
      description: typeof s.$description === 'string' ? s.$description : '',
      required: s.$required === true,
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
                <Text color={isActiveCursor ? 'cyan' : 'white'}>
                  {isActiveCursor ? `▶ ${v}` : `  ${v}`}
                </Text>
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
  cursorVisible,
  width,
}: {
  slot: SlotState;
  selected: boolean;
  activeField: SlotField | null;
  textCursor: number;
  cursorVisible: boolean;
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

type PropField = 'type' | 'category' | 'required' | 'description' | 'tokenKind' | 'values';
type SlotField = 'required' | 'description';

// Field order is intentional: description is LAST so it's the "edge" of the
// field cycle. The user reaches description by walking through type → category
// → required → [tokenKind?] → [values?] → description via j/k; once active,
// description swallows j/k as literal text input. Putting it last means the
// user has to deliberately navigate to it, avoiding accidental text-entry.
function propFields(prop: PropState): PropField[] {
  const fields: PropField[] = ['type', 'category', 'required'];
  if (prop.type === 'token') fields.push('tokenKind');
  if (prop.type === 'enum') fields.push('values');
  fields.push('description');
  return fields;
}
const SLOT_FIELDS: SlotField[] = ['required', 'description'];

// ── Main component ────────────────────────────────────────────────────────────

export function FieldEditor({
  value,
  width,
  height,
  active = true,
  onChange,
  onSave,
  onDiscard,
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
    if (editingValue && currentProp && activeField === 'values') {
      const vals = currentProp.values;
      if (key.return) {
        const trimmed = valueText.trim();
        if (trimmed) {
          let nextVals: string[];
          let cursorAfter: number;
          if (editingValue.mode === 'add') {
            nextVals = [...vals, trimmed];
            cursorAfter = nextVals.length - 1;
          } else {
            const idx = editingValue.index ?? 0;
            nextVals = vals.map((v, i) => (i === idx ? trimmed : v));
            cursorAfter = idx;
          }
          const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: nextVals } : p));
          commit({ ...editorState, props: nextProps });
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
    if (key.escape) {
      if (focusLevel === 'field') {
        // Exit field editing back to prop/slot row level
        setFocusLevel(inSlots ? 'slot' : 'prop');
        setActiveField(null);
        return;
      }
      onDiscard();
      return;
    }

    // ── Prop-level navigation (not inside a field) ───────────────────────────
    // Arrows / j / k move between rows. Return enters field-edit at the FIRST
    // field of the current prop (type). No auto-focus on description.
    if (focusLevel === 'prop') {
      if (key.upArrow || input === 'k') {
        if (propIdx > 0) {
          setPropIdx(propIdx - 1);
        } else if (slots.length > 0) {
          setInSlots(true);
          setSlotIdx(slots.length - 1);
          setFocusLevel('slot');
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
      const isValuesNav = activeField === 'values';
      const arrowUp = key.upArrow;
      const arrowDown = key.downArrow;

      // ── Inside description: arrow keys exit field-edit and navigate ROWS
      //    at the row level (NOT auto-focusing description on the new row);
      //    j/k type literal characters into the description.
      if (isDescriptionTextEntry && (arrowUp || arrowDown)) {
        const exitToRow = (nextInSlots: boolean) => {
          setFocusLevel(nextInSlots ? 'slot' : 'prop');
          setActiveField(null);
        };
        if (arrowUp) {
          if (!inSlots && propIdx > 0) {
            setPropIdx(propIdx - 1);
            exitToRow(false);
          } else if (inSlots && slotIdx > 0) {
            setSlotIdx(slotIdx - 1);
            exitToRow(true);
          } else if (inSlots && slotIdx === 0 && props.length > 0) {
            setInSlots(false);
            setPropIdx(props.length - 1);
            exitToRow(false);
          }
        } else {
          // arrowDown
          if (!inSlots && propIdx < props.length - 1) {
            setPropIdx(propIdx + 1);
            exitToRow(false);
          } else if (!inSlots && propIdx === props.length - 1 && slots.length > 0) {
            setInSlots(true);
            setSlotIdx(0);
            exitToRow(true);
          } else if (inSlots && slotIdx < slots.length - 1) {
            setSlotIdx(slotIdx + 1);
            exitToRow(true);
          }
        }
        return;
      }

      // ── Inside values: arrow keys AND j/k navigate BETWEEN VALUES, not
      //    between fields. Reorder is K/J (capital).
      if (isValuesNav && currentProp) {
        const vals = currentProp.values;
        if (arrowUp || input === 'k') {
          setValueCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (arrowDown || input === 'j') {
          setValueCursor((c) => Math.max(0, Math.min(vals.length - 1, c + 1)));
          return;
        }
      }

      // ── Other fields (type/category/required/tokenKind): j/k or arrows
      //    move between fields.
      if (!isDescriptionTextEntry && !isValuesNav) {
        const navUp = arrowUp || input === 'k';
        const navDown = arrowDown || input === 'j';
        if (navUp) {
          if (currentFieldIdx > 0) {
            const next = fields[currentFieldIdx - 1] as PropField | SlotField;
            setActiveField(next);
            if (next === 'description') {
              const desc = inSlots ? (currentSlot?.description ?? '') : (currentProp?.description ?? '');
              setTextCursor(desc.length);
            }
          } else {
            // Back to row navigation
            setFocusLevel(inSlots ? 'slot' : 'prop');
            setActiveField(null);
          }
          return;
        }
        if (navDown) {
          if (currentFieldIdx < fields.length - 1) {
            const next = fields[currentFieldIdx + 1] as PropField | SlotField;
            setActiveField(next);
            if (next === 'description') {
              const desc = inSlots ? (currentSlot?.description ?? '') : (currentProp?.description ?? '');
              setTextCursor(desc.length);
            }
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

      // ── Description text input ─────────────────────────────────────────────
      if (activeField === 'description') {
        const getDesc = () => (inSlots ? (currentSlot?.description ?? '') : (currentProp?.description ?? ''));
        const setDesc = (next: string) => {
          if (inSlots && currentSlot) {
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
        <Text bold>FIELD EDITOR — no fields</Text>
        <Text dimColor>This component has no properties or slots to edit.</Text>
        <Text dimColor>Ctrl+S to save · Esc to discard</Text>
      </Box>
    );
  }

  const modeLabel = (() => {
    if (editingValue) {
      return editingValue.mode === 'add'
        ? 'Enter to add · Esc to cancel'
        : 'Enter to save edit · Esc to cancel';
    }
    if (focusLevel === 'field' && activeField === 'description') {
      return 'Type to edit  ←→ cursor  ↑↓ row  Esc exit  Ctrl+S save';
    }
    if (focusLevel === 'field' && (activeField === 'type' || activeField === 'category' || activeField === 'tokenKind')) {
      return '←→ cycle  ↑↓/jk next field  Esc exit';
    }
    if (focusLevel === 'field' && activeField === 'required') {
      return 'Space/Enter toggle  ↑↓/jk next field  Esc exit';
    }
    if (focusLevel === 'field' && activeField === 'values') {
      return '[a]dd  [e]dit  [r]emove  ↑↓/jk navigate  [K/J] reorder  Esc exit';
    }
    return '↑↓/jk navigate rows  Enter edit fields  Ctrl+S save  Esc discard';
  })();

  // Build visible rows
  type Row = { kind: 'header'; label: string } | { kind: 'prop'; idx: number } | { kind: 'slot'; idx: number };

  const rows: Row[] = [];
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
      (r.kind === 'prop' && !inSlots && r.idx === propIdx) ||
      (r.kind === 'slot' && inSlots && r.idx === slotIdx),
  );
  const visibleRows = Math.max(1, height - 3); // title + hint bar + border
  const scrollStart = selectedRowIdx < 0 ? 0 : Math.max(0, Math.min(selectedRowIdx, rows.length - visibleRows));
  const visibleRowSlice = rows.slice(scrollStart, scrollStart + visibleRows);

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor="cyan">
      <Text bold color="cyan">
        {'FIELDS [Ctrl+S save · Esc discard]'}
      </Text>

      <Box flexDirection="column" width={innerWidth}>
        {visibleRowSlice.map((row, i) => {
          if (row.kind === 'header') {
            return (
              <Text key={i} dimColor>
                {row.label}
              </Text>
            );
          }
          if (row.kind === 'prop') {
            const p = props[row.idx]!;
            const isSelected = !inSlots && row.idx === propIdx;
            return (
              <PropRow
                key={row.idx}
                prop={p}
                selected={isSelected}
                activeField={isSelected && focusLevel === 'field' ? (activeField as PropField) : null}
                textCursor={textCursor}
                valueCursor={valueCursor}
                cursorVisible={cursorVisible}
                editingValue={isSelected ? editingValue : null}
                valueText={isSelected ? valueText : ''}
                width={innerWidth}
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
              cursorVisible={cursorVisible}
              width={innerWidth}
            />
          );
        })}

      </Box>

      {validationError && <Text color="red">{'✗ ' + validationError}</Text>}
      <Text dimColor>{modeLabel}</Text>
    </Box>
  );
}

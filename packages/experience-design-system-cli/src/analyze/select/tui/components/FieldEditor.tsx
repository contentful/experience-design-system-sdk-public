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
 *   'value'    — a single item inside a $values list (editing mode)
 */
type FocusLevel = 'section' | 'prop' | 'slot' | 'field' | 'value';

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
  width,
}: {
  prop: PropState;
  selected: boolean;
  activeField: PropField | null;
  textCursor: number;
  valueCursor: number;
  cursorVisible: boolean;
  width: number;
}): React.ReactElement {
  const cursor = cursorVisible ? '█' : ' ';
  const bg = selected ? 'blue' : undefined;

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

      {/* $description sub-row — only when selected */}
      {selected && (
        <Box paddingLeft={2} gap={1}>
          <Text dimColor>desc:</Text>
          {activeField === 'description' ? (
            <Box>
              <Text>{prop.description.slice(0, textCursor)}</Text>
              <Text inverse={cursorVisible}>{prop.description[textCursor] ?? cursor}</Text>
              <Text>{prop.description.slice(textCursor + 1)}</Text>
            </Box>
          ) : (
            <Text color="green">{prop.description || '—'}</Text>
          )}
        </Box>
      )}

      {/* $values sub-list — only when selected and type=enum */}
      {selected && prop.type === 'enum' && (
        <Box paddingLeft={2} flexDirection="column">
          <Text dimColor>values:</Text>
          {prop.values.length === 0 && <Text dimColor> (none)</Text>}
          {prop.values.map((v, i) => (
            <Box key={i} gap={1} paddingLeft={2}>
              <Text color={activeField === 'values' && valueCursor === i ? 'cyan' : 'white'}>
                {activeField === 'values' && valueCursor === i ? `▶ ${v}` : `  ${v}`}
              </Text>
            </Box>
          ))}
          {activeField === 'values' && (
            <Box paddingLeft={2}>
              <Text dimColor>[+] add [x] remove [[] up []] down [Esc] done</Text>
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
      {selected && (
        <Box paddingLeft={2} gap={1}>
          <Text dimColor>desc:</Text>
          {activeField === 'description' ? (
            <Box>
              <Text>{slot.description.slice(0, textCursor)}</Text>
              <Text inverse={cursorVisible}>{slot.description[textCursor] ?? cursor}</Text>
              <Text>{slot.description.slice(textCursor + 1)}</Text>
            </Box>
          ) : (
            <Text color="green">{slot.description || '—'}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Field navigation types ─────────────────────────────────────────────────

type PropField = 'type' | 'category' | 'required' | 'description' | 'tokenKind' | 'values';
type SlotField = 'required' | 'description';

const PROP_FIELDS_BASE: PropField[] = ['type', 'category', 'required', 'description'];
function propFields(prop: PropState): PropField[] {
  const fields: PropField[] = [...PROP_FIELDS_BASE];
  if (prop.type === 'token') fields.splice(3, 0, 'tokenKind');
  if (prop.type === 'enum') fields.push('values');
  return fields;
}
const SLOT_FIELDS: SlotField[] = ['required', 'description'];

// ── Main component ────────────────────────────────────────────────────────────

export function FieldEditor({
  value,
  width,
  height,
  onChange,
  onSave,
  onDiscard,
}: FieldEditorProps): React.ReactElement {
  const { state: initialState, error: parseError } = parseToState(value);

  const [editorState, setEditorState] = useState<EditorState>(initialState);
  const [parseErr] = useState<string | null>(parseError);

  // Navigation state
  const [focusLevel, setFocusLevel] = useState<FocusLevel>('prop');
  const [propIdx, setPropIdx] = useState(0);
  const [slotIdx, setSlotIdx] = useState(0);
  // Whether we're navigating props (true) or slots (false) at the top level
  const [inSlots, setInSlots] = useState(false);
  // Active field within a prop/slot
  const [activeField, setActiveField] = useState<PropField | SlotField | null>(null);
  // Text cursor position for description fields
  const [textCursor, setTextCursor] = useState(0);
  // Value list cursor for $values editing
  const [valueCursor, setValueCursor] = useState(0);
  // New value being typed in $values add mode
  const [addingValue, setAddingValue] = useState(false);
  const [newValueText, setNewValueText] = useState('');

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
        setAddingValue(false);
        setNewValueText('');
        return;
      }
      if (focusLevel === 'value') {
        setFocusLevel('field');
        setAddingValue(false);
        setNewValueText('');
        return;
      }
      onDiscard();
      return;
    }

    // ── Prop-level navigation (not inside a field) ───────────────────────────
    if (focusLevel === 'prop') {
      if (key.upArrow || input === 'k') {
        if (propIdx > 0) {
          setPropIdx((i) => i - 1);
          setActiveField(null);
        } else if (slots.length > 0) {
          setInSlots(true);
          setFocusLevel('slot');
          setActiveField(null);
        }
        return;
      }
      if (key.downArrow || input === 'j') {
        if (propIdx < props.length - 1) {
          setPropIdx((i) => i + 1);
          setActiveField(null);
        } else if (slots.length > 0) {
          setInSlots(true);
          setFocusLevel('slot');
          setActiveField(null);
        }
        return;
      }
      if (key.return && currentProp) {
        // Enter field editing on the first field of this prop
        setFocusLevel('field');
        setActiveField(propFields(currentProp)[0] ?? null);
        setTextCursor(currentProp.description.length);
        return;
      }
      return;
    }

    // ── Slot-level navigation ────────────────────────────────────────────────
    if (focusLevel === 'slot') {
      if (key.upArrow || input === 'k') {
        if (slotIdx > 0) {
          setSlotIdx((i) => i - 1);
          setActiveField(null);
        } else if (props.length > 0) {
          setInSlots(false);
          setFocusLevel('prop');
          setPropIdx(props.length - 1);
          setActiveField(null);
        }
        return;
      }
      if (key.downArrow || input === 'j') {
        if (slotIdx < slots.length - 1) {
          setSlotIdx((i) => i + 1);
          setActiveField(null);
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

      if (key.upArrow || input === 'k') {
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
      if (key.downArrow || input === 'j') {
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

      // ── Enter $values sub-list ─────────────────────────────────────────────
      if (activeField === 'values' && key.return && currentProp) {
        setFocusLevel('value');
        setValueCursor(0);
        return;
      }

      return;
    }

    // ── Value-list editing ────────────────────────────────────────────────────
    if (focusLevel === 'value' && currentProp) {
      const vals = currentProp.values;

      if (addingValue) {
        // Typing a new value
        if (key.return) {
          if (newValueText.trim()) {
            const nextVals = [...vals, newValueText.trim()];
            const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: nextVals } : p));
            commit({ ...editorState, props: nextProps });
            setValueCursor(nextVals.length - 1);
          }
          setAddingValue(false);
          setNewValueText('');
          return;
        }
        if (key.escape) {
          setAddingValue(false);
          setNewValueText('');
          return;
        }
        if (key.backspace) {
          setNewValueText((t) => t.slice(0, -1));
          return;
        }
        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setNewValueText((t) => t + input);
          return;
        }
        return;
      }

      if (key.upArrow || input === 'k') {
        setValueCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setValueCursor((c) => Math.max(0, Math.min(vals.length - 1, c + 1)));
        return;
      }
      if (key.escape) {
        setFocusLevel('field');
        return;
      }

      if (input === '+') {
        setAddingValue(true);
        setNewValueText('');
        return;
      }

      if (input === 'x' && vals.length > 0) {
        const nextVals = vals.filter((_, i) => i !== valueCursor);
        const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: nextVals } : p));
        commit({ ...editorState, props: nextProps });
        setValueCursor((c) => Math.max(0, Math.min(c, nextVals.length - 1)));
        return;
      }

      // '[' moves item up, ']' moves item down
      if (input === '[' && valueCursor > 0) {
        const nextVals = [...vals];
        [nextVals[valueCursor - 1], nextVals[valueCursor]] = [nextVals[valueCursor], nextVals[valueCursor - 1]];
        const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: nextVals } : p));
        commit({ ...editorState, props: nextProps });
        setValueCursor((c) => c - 1);
        return;
      }

      if (input === ']' && valueCursor < vals.length - 1) {
        const nextVals = [...vals];
        [nextVals[valueCursor], nextVals[valueCursor + 1]] = [nextVals[valueCursor + 1], nextVals[valueCursor]];
        const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: nextVals } : p));
        commit({ ...editorState, props: nextProps });
        setValueCursor((c) => c + 1);
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

  const modeLabel =
    focusLevel === 'field' && activeField === 'description'
      ? '← → move cursor  Esc exit field'
      : focusLevel === 'field' && (activeField === 'type' || activeField === 'category' || activeField === 'tokenKind')
        ? '← → cycle values  ↑↓ next field  Esc exit'
        : focusLevel === 'field' && activeField === 'required'
          ? 'Space/Enter toggle  ↑↓ next field  Esc exit'
          : focusLevel === 'field' && activeField === 'values'
            ? 'Enter edit list  Esc exit field'
            : focusLevel === 'value'
              ? '+ add  x remove  [ up  ] down  Esc done'
              : '↑↓ navigate  Enter edit fields  Ctrl+S save  Esc discard';

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
      (r.kind === 'prop' && !inSlots && r.idx === propIdx && focusLevel !== 'section') ||
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

        {/* "Adding value" inline input */}
        {focusLevel === 'value' && addingValue && (
          <Box paddingLeft={4} gap={1}>
            <Text color="cyan">+ </Text>
            <Text>{newValueText}</Text>
            <Text inverse={cursorVisible}> </Text>
            <Text dimColor>(Enter confirm · Esc cancel)</Text>
          </Box>
        )}
      </Box>

      {validationError && <Text color="red">{'✗ ' + validationError}</Text>}
      <Text dimColor>{modeLabel}</Text>
    </Box>
  );
}

import React, { useEffect, useLayoutEffect, useState } from 'react';
import figures from 'figures';
import { PALETTE } from '../theme.js';
import { Box, measureElement, Text, type DOMElement } from 'ink';
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
import { computeNextScrollOffset } from '../hooks/scroll-offset.js';
import { findSlotCycles, type ComponentSlotInfo } from '../../../cycle-detection.js';
import { FixedPanel } from '../../../../tui/windowed-panel.js';

type PropMetadata = {
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

export type FieldEditorProps = {
  value: string;
  width: number;
  height: number;
  fixedHeight?: boolean;
  active?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onExit?: () => void;
  metadata?: FieldEditorMetadata;
  onTogglePropRationale?: () => void;
  propRationaleKey?: string;
  onToggleComponentRationale?: () => void;
  componentRationaleKey?: string;
  onToggleSourceExternal?: () => void;
  onTextEntryActiveChange?: (active: boolean) => void;
  projectSlotGraph?: ComponentSlotInfo[];
  currentComponentName?: string;
  onDirtyChange?: (isDirty: boolean) => void;
  discardTrigger?: number;
  initialFocusTarget?: { kind: 'description' } | { kind: 'prop' | 'slot'; name: string };
  showHiddenProps?: boolean;
  showInlineRationales?: boolean;
};

type FocusLevel = 'section' | 'prop' | 'slot' | 'field' | 'componentDescription';

type PropState = {
  name: string;
  type: (typeof CDF_PROPERTY_TYPES)[number];
  category: (typeof CDF_PROPERTY_CATEGORIES)[number];
  required: boolean;
  description: string;
  values: string[];
  tokenKind: string;
  allowed: string[];
  default: string | boolean | null;
};

type SlotState = {
  name: string;
  description: string;
  required: boolean;
  allowedComponents: string[];
};

type EditorState = {
  componentDescription: string;
  props: PropState[];
  slots: SlotState[];
};

type EditingValue = { mode: 'add' | 'edit'; index?: number };

function createCommonRowProps(
  selected: boolean,
  focusLevel: FocusLevel,
  editingField: boolean,
  textCursor: number,
  valueCursor: number,
  cursorVisible: boolean,
  editingValue: EditingValue | null,
  valueText: string,
  width: number,
) {
  return {
    selected,
    editingField: selected && focusLevel === 'field' && editingField,
    textCursor,
    valueCursor,
    cursorVisible,
    editingValue: selected ? editingValue : null,
    valueText: selected ? valueText : '',
    width,
  };
}

function removeAt<T>(values: T[], index: number): T[] {
  return values.filter((_, i) => i !== index);
}

function swapValues<T>(values: T[], firstIndex: number, secondIndex: number): T[] {
  const next = [...values];
  [next[firstIndex], next[secondIndex]] = [next[secondIndex], next[firstIndex]];
  return next;
}

function parseToState(json: string): {
  state: EditorState;
  error: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      state: { componentDescription: '', props: [], slots: [] },
      error: String(e),
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      state: { componentDescription: '', props: [], slots: [] },
      error: 'Expected a JSON object',
    };
  }

  const entry = parsed as Record<string, unknown>;

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
      allowed: Array.isArray(p['$token.allowed'])
        ? (p['$token.allowed'] as unknown[]).filter((v): v is string => typeof v === 'string')
        : [],
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
  } catch {}

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
    if (p.type === 'token' && p.allowed.length > 0) def['$token.allowed'] = p.allowed;
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

function Picker({ value, active }: { value: string; active: boolean }): React.ReactElement {
  return (
    <Box>
      {active && <Text color={PALETTE.warning}>{'‹'}</Text>}
      <Text color={active ? PALETTE.warning : PALETTE.inverse} bold={active}>
        {value}
      </Text>
      {active && <Text color={PALETTE.warning}>{'›'}</Text>}
    </Box>
  );
}

function Toggle({ value, active }: { value: boolean; active: boolean }): React.ReactElement {
  return (
    <Box>
      <Text color={active ? PALETTE.warning : value ? PALETTE.success : PALETTE.border}>{value ? '[✓]' : '[ ]'}</Text>
    </Box>
  );
}

function InlinePropField({
  label,
  focused = false,
  children,
  flexible = false,
  width,
}: {
  label: string;
  focused?: boolean;
  children: React.ReactNode;
  flexible?: boolean;
  width?: number;
}): React.ReactElement {
  return (
    <Box width={width} gap={1} flexShrink={flexible ? 1 : 0} flexGrow={flexible ? 1 : 0} flexWrap="wrap">
      <Text
        color={focused ? PALETTE.warning : undefined}
        bold={focused}
        dimColor={!focused}
        wrap="truncate-end"
      >
        {focused ? '› ' : '  '}
        {label}
      </Text>
      {children}
    </Box>
  );
}

function RequiredField({
  value,
  focused,
  editingField,
  activeField,
}: {
  value: boolean;
  focused: boolean;
  editingField: boolean;
  activeField: PropField | SlotField | null;
}): React.ReactElement {
  return (
    <InlinePropField label="req:" focused={focused}>
      <Toggle value={value} active={editingField && activeField === 'required'} />
    </InlinePropField>
  );
}

function DefaultValueRow({
  display,
  active,
  focused,
}: {
  display: string;
  active: boolean;
  focused: boolean;
}): React.ReactElement {
  return (
    <Box gap={1} flexWrap="wrap" flexShrink={0}>
      <Text color={focused ? PALETTE.warning : undefined} bold={focused} dimColor={!focused}>
        {focused ? '› ' : '  '}default:
      </Text>
      {active ? (
        <Picker value={display} active={true} />
      ) : (
        <Text color={focused ? PALETTE.inverse : PALETTE.inverse} wrap="wrap">
          {display}
        </Text>
      )}
    </Box>
  );
}

function RowLabel({
  name,
  selected,
  trailing = true,
}: {
  name: string;
  selected: boolean;
  trailing?: boolean;
}): React.ReactElement {
  return (
    <Text
      color={selected ? PALETTE.inverse : PALETTE.info}
      bold={selected}
      backgroundColor={selected ? 'blue' : undefined}
      wrap="truncate-end"
    >
      {' '}
      {name}
      {trailing ? ' ' : ''}
    </Text>
  );
}

function ValueInputRow({
  mode,
  valueText,
  cursorVisible,
}: {
  mode: 'add' | 'edit';
  valueText: string;
  cursorVisible: boolean;
}): React.ReactElement {
  return (
    <Box paddingLeft={2}>
      <Text color={PALETTE.info}>{mode === 'edit' ? '✎ ' : '+ '}</Text>
      <Text>{valueText}</Text>
      <Text inverse={cursorVisible}> </Text>
    </Box>
  );
}

function EditableListItem({
  value,
  index,
  active,
  editingValue,
  valueText,
  cursorVisible,
}: {
  value: string;
  index: number;
  active: boolean;
  editingValue: EditingValue | null;
  valueText: string;
  cursorVisible: boolean;
}): React.ReactElement {
  const isBeingEdited = editingValue?.mode === 'edit' && editingValue.index === index;
  if (isBeingEdited) {
    return <ValueInputRow mode="edit" valueText={valueText} cursorVisible={cursorVisible} />;
  }
  return (
    <Box gap={1} paddingLeft={2}>
      <Text color={active ? PALETTE.info : PALETTE.inverse}>
        {active ? `${figures.pointer} ${value}` : `  ${value}`}
      </Text>
    </Box>
  );
}

function EditableValueList({
  values,
  valueCursor,
  cursorActive,
  editingValue,
  valueText,
  cursorVisible,
  emptyMessage,
  emptyPaddingLeft,
  showAddInput,
}: {
  values: string[];
  valueCursor: number;
  cursorActive: boolean;
  editingValue: EditingValue | null;
  valueText: string;
  cursorVisible: boolean;
  emptyMessage: string;
  emptyPaddingLeft?: number;
  showAddInput: boolean;
}): React.ReactElement {
  return (
    <>
      {values.length === 0 &&
        !editingValue &&
        (emptyPaddingLeft === undefined ? (
          <Text dimColor>{emptyMessage}</Text>
        ) : (
          <Box paddingLeft={emptyPaddingLeft}>
            <Text dimColor>{emptyMessage}</Text>
          </Box>
        ))}
      {values.map((value, index) => (
        <EditableListItem
          key={index}
          value={value}
          index={index}
          active={cursorActive && valueCursor === index}
          editingValue={editingValue}
          valueText={valueText}
          cursorVisible={cursorVisible}
        />
      ))}
      {showAddInput && editingValue?.mode === 'add' && (
        <ValueInputRow mode="add" valueText={valueText} cursorVisible={cursorVisible} />
      )}
    </>
  );
}

function DefaultSubRow({
  prop,
  active,
  focused,
  textCursor,
  cursorVisible,
}: {
  prop: PropState;
  active: boolean;
  focused: boolean;
  textCursor: number;
  cursorVisible: boolean;
}): React.ReactElement {
  const cursor = cursorVisible ? '█' : ' ';
  if (prop.type === 'richtext' || prop.type === 'media' || prop.type === 'link') {
    return (
      <Box gap={1} flexShrink={0}>
        <Text color={focused ? PALETTE.warning : undefined} bold={focused} dimColor={!focused}>
          {focused ? '› ' : '  '}default:
        </Text>
        <Text dimColor={!focused}>(not applicable)</Text>
      </Box>
    );
  }

  if (prop.type === 'boolean') {
    const display = prop.default === true ? 'true' : prop.default === false ? 'false' : '(unset)';
    return <DefaultValueRow display={display} active={active} focused={focused} />;
  }

  if (prop.type === 'enum') {
    if (prop.values.length === 0) {
      return (
        <Box gap={1} flexShrink={0}>
          <Text color={focused ? PALETTE.warning : undefined} bold={focused} dimColor={!focused}>
            {focused ? '› ' : '  '}default:
          </Text>
          <Text dimColor={!focused}>(no values defined)</Text>
        </Box>
      );
    }
    const display = typeof prop.default === 'string' && prop.default !== '' ? prop.default : '(unset)';
    return <DefaultValueRow display={display} active={active} focused={focused} />;
  }

  const value = typeof prop.default === 'string' ? prop.default : '';
  if (active) {
    return (
      <Box flexDirection="row" flexShrink={0}>
        <Text color={focused ? PALETTE.warning : undefined} bold={focused} dimColor={!focused}>
          {focused ? '› ' : '  '}default:
        </Text>
        <Box flexGrow={1} borderStyle="round" borderColor={PALETTE.warning} paddingX={1}>
          <Text>{value.slice(0, textCursor)}</Text>
          <Text inverse={cursorVisible}>{value[textCursor] ?? cursor}</Text>
          <Text>{value.slice(textCursor + 1)}</Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box gap={1} flexShrink={0}>
      <Text color={focused ? PALETTE.warning : undefined} bold={focused} dimColor={!focused}>
        {focused ? '› ' : '  '}default:
      </Text>
      <Text color={focused ? PALETTE.inverse : value ? PALETTE.inverse : undefined} dimColor={!value && !focused}>
        {value || '(none)'}
      </Text>
    </Box>
  );
}

function DescriptionField({
  value,
  focused,
  editing,
  textCursor,
  cursorVisible,
  width,
  label = 'desc:',
  compact = false,
  paddingLeft = 2,
}: {
  value: string;
  focused: boolean;
  editing: boolean;
  textCursor: number;
  cursorVisible: boolean;
  width?: number;
  label?: string;
  compact?: boolean;
  paddingLeft?: number;
}): React.ReactElement {
  const cursor = cursorVisible ? '█' : ' ';
  if (compact) {
    return (
      <Box gap={1} flexWrap="wrap" width={width} flexShrink={0}>
        <Text color={focused ? PALETTE.warning : undefined} bold={focused} dimColor={!focused}>
          {focused ? '› ' : '  '}
          {label}
        </Text>
        <Text wrap="truncate-end" dimColor={!value}>
          {value || '—'}
        </Text>
      </Box>
    );
  }
  return (
    <Box paddingLeft={paddingLeft} flexDirection="column" width={width} flexShrink={0}>
      <Text color={focused ? PALETTE.warning : undefined} bold={focused} dimColor={!focused}>
        {focused ? '› ' : '  '}
        {label}
      </Text>
      {editing ? (
        <EditableDescription cursor={cursor} cursorVisible={cursorVisible} value={value} textCursor={textCursor} />
      ) : (
        <Text wrap="wrap">{value || '—'}</Text>
      )}
    </Box>
  );
}

function EditableDescription({
  cursor,
  cursorVisible,
  value,
  textCursor,
}: {
  cursor: string;
  cursorVisible: boolean;
  value: string;
  textCursor: number;
}): React.ReactElement {
  return (
    <Text wrap="wrap">
      {value.slice(0, textCursor)}
      <Text inverse={cursorVisible}>{cursor}</Text>
      {value.slice(textCursor)}
    </Text>
  );
}

function PropRow({
  prop,
  selected,
  activeField,
  editingField,
  textCursor,
  valueCursor,
  cursorVisible,
  editingValue,
  valueText,
  width,
  rationale,
  showRationale,
  rowKey,
}: {
  prop: PropState;
  selected: boolean;
  activeField: PropField | null;
  editingField: boolean;
  textCursor: number;
  valueCursor: number;
  cursorVisible: boolean;
  editingValue: EditingValue | null;
  valueText: string;
  width: number;
  rationale?: string | null;
  showRationale: boolean;
  rowKey?: string;
}): React.ReactElement {
  const descFocused = activeField === 'description';
  const descActive = editingField && descFocused;

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box gap={1} flexWrap="wrap" width={width} flexShrink={0}>
        <RowLabel name={prop.name} selected={selected} />
      </Box>

      <DescriptionField
        value={prop.description}
        focused={selected && descFocused}
        editing={selected && descActive}
        textCursor={textCursor}
        cursorVisible={cursorVisible}
        width={width}
        compact={!descActive}
        paddingLeft={0}
      />

      <Box flexDirection="column" width={width} flexShrink={0}>
        <RequiredField
          value={prop.required}
          focused={activeField === 'required'}
          editingField={editingField}
          activeField={activeField}
        />

        <InlinePropField label="type:" focused={activeField === 'type'}>
          {editingField && activeField === 'type' ? (
            <Picker value={prop.type} active={true} />
          ) : (
            <Text color={selected ? PALETTE.inverse : PALETTE.inverse}>{prop.type}</Text>
          )}
        </InlinePropField>
      </Box>

      {prop.type === 'token' && (
        <InlinePropField label="kind:" focused={activeField === 'tokenKind'} width={width}>
          {editingField && activeField === 'tokenKind' ? (
            <Picker value={prop.tokenKind || DESIGN_TOKEN_TYPES[0]} active={true} />
          ) : (
            <Text color={selected ? PALETTE.inverse : PALETTE.inverse} wrap="wrap">
              {prop.tokenKind || '—'}
            </Text>
          )}
        </InlinePropField>
      )}

      {prop.type === 'enum' && (
        <Box gap={1} flexWrap="wrap" width={width} flexShrink={0}>
          <Text
            color={activeField === 'values' ? PALETTE.warning : undefined}
            bold={activeField === 'values'}
            dimColor={activeField !== 'values'}
          >
            {activeField === 'values' ? '› ' : '  '}values:
          </Text>
          <Text color={activeField === 'values' ? PALETTE.inverse : selected ? PALETTE.inverse : undefined} wrap="wrap">
            [{prop.values.join(', ')}]
          </Text>
        </Box>
      )}

      <DefaultSubRow
        prop={prop}
        active={selected && editingField && activeField === 'default'}
        focused={selected && activeField === 'default'}
        textCursor={textCursor}
        cursorVisible={cursorVisible}
      />

      {prop.type === 'token' && prop.category === 'design' && (
        <Box gap={1} flexWrap="wrap" width={width} flexShrink={0}>
          <Text
            color={activeField === 'allowed' ? PALETTE.warning : undefined}
            bold={activeField === 'allowed'}
            dimColor={activeField !== 'allowed'}
          >
            {activeField === 'allowed' ? '› ' : '  '}allowed:
          </Text>
          {editingField && activeField === 'allowed' ? (
            <Box width={Math.max(1, width - 4)} borderStyle="round" borderColor={PALETTE.warning} paddingX={1}>
              <Text dimColor>press [t] to edit allowed tokens</Text>
            </Box>
          ) : (
            <Text
              color={activeField === 'allowed' ? PALETTE.inverse : undefined}
              dimColor={prop.allowed.length === 0 && activeField !== 'allowed'}
              wrap="wrap"
            >
              {prop.allowed.length > 0 ? prop.allowed.join(', ') : '(any)'}
            </Text>
          )}
        </Box>
      )}

      {selected && showRationale && rationale && rationale.trim().length > 0 && (
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

      {selected && prop.type === 'enum' && activeField === 'values' && (
        <Box paddingLeft={2} flexDirection="column">
          <Box>
            <Text dimColor>values:</Text>
            {activeField === 'values' && (
              <Text dimColor>{'  [a]dd  [e]dit  [r]emove  [↑↓] navigate  [K/J] reorder'}</Text>
            )}
          </Box>
          <EditableValueList
            values={prop.values}
            valueCursor={valueCursor}
            cursorActive={activeField === 'values'}
            editingValue={editingValue}
            valueText={valueText}
            cursorVisible={cursorVisible}
            emptyMessage=" (none — press [a] to add)"
            showAddInput={true}
          />
        </Box>
      )}
    </Box>
  );
}

function SlotRow({
  slot,
  selected,
  activeField,
  editingField,
  textCursor,
  valueCursor,
  cursorVisible,
  editingValue,
  valueText,
  width,
  pickerCandidates,
  pickerCursor,
}: {
  slot: SlotState;
  selected: boolean;
  activeField: SlotField | null;
  editingField: boolean;
  textCursor: number;
  valueCursor: number;
  cursorVisible: boolean;
  editingValue: EditingValue | null;
  valueText: string;
  width: number;
  pickerCandidates: string[] | null;
  pickerCursor: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box gap={1} flexWrap="wrap" width={width} flexShrink={0}>
        <RowLabel name={slot.name} selected={selected} trailing={false} />
      </Box>

      <DescriptionField
        value={slot.description}
        focused={selected && activeField === 'description'}
        editing={selected && editingField && activeField === 'description'}
        textCursor={textCursor}
        cursorVisible={cursorVisible}
        width={width}
        compact={!(selected && editingField && activeField === 'description')}
        paddingLeft={0}
      />

      <Box gap={1} flexWrap="wrap" width={width} flexShrink={0}>
        <RequiredField
          value={slot.required}
          focused={activeField === 'required'}
          editingField={editingField}
          activeField={activeField}
        />
      </Box>

      {!(selected && editingField && activeField === 'allowedComponents') && (
        <Box gap={1} flexWrap="wrap" width={width} flexShrink={0}>
          <Text
            color={activeField === 'allowedComponents' ? PALETTE.warning : undefined}
            bold={activeField === 'allowedComponents'}
            dimColor={activeField !== 'allowedComponents'}
          >
            {activeField === 'allowedComponents' ? '› ' : '  '}allowed:
          </Text>
          {slot.allowedComponents.length === 0 ? (
            <Text dimColor>(any)</Text>
          ) : (
            <Text wrap="wrap">{slot.allowedComponents.join(', ')}</Text>
          )}
        </Box>
      )}
      {selected && editingField && activeField === 'allowedComponents' && (
        <Box flexDirection="column">
          <Box>
            <Text
              color={activeField === 'allowedComponents' ? PALETTE.warning : undefined}
              bold={activeField === 'allowedComponents'}
              dimColor={activeField !== 'allowedComponents'}
            >
              {activeField === 'allowedComponents' ? '› ' : '  '}allowed:
            </Text>
            {editingField && activeField === 'allowedComponents' && (
              <Text dimColor>
                {slot.allowedComponents.length > 0
                  ? '  [a]dd  [e]dit  [r]emove  [←→] cycle  [↑↓] navigate  [K/J] reorder'
                  : '  [a]dd  [e]dit  [r]emove  [↑↓] navigate  [K/J] reorder'}
              </Text>
            )}
          </Box>
          <EditableValueList
            values={slot.allowedComponents}
            valueCursor={valueCursor}
            cursorActive={editingField && activeField === 'allowedComponents'}
            editingValue={editingValue}
            valueText={valueText}
            cursorVisible={cursorVisible}
            emptyMessage={editingField && activeField === 'allowedComponents' ? '(any — press [a] to add)' : '(any)'}
            emptyPaddingLeft={2}
            showAddInput={editingField && activeField === 'allowedComponents'}
          />
          {editingField &&
            editingValue?.mode === 'add' &&
            activeField === 'allowedComponents' &&
            pickerCandidates !== null && (
              <Box paddingLeft={2} flexDirection="column">
                {pickerCandidates.length === 0 ? (
                  <Text dimColor>{'(no valid components to add — all remaining candidates would create cycles)'}</Text>
                ) : (
                  (() => {
                    const filtered =
                      valueText.length === 0
                        ? pickerCandidates
                        : pickerCandidates.filter((n) => n.toLowerCase().includes(valueText.toLowerCase()));
                    if (filtered.length === 0) {
                      return <Text dimColor>{'(no candidates match — Enter to add as free text)'}</Text>;
                    }
                    const cursor = pickerCursor % filtered.length;
                    const MAX_VISIBLE = 5;
                    const start = Math.max(0, Math.min(filtered.length - MAX_VISIBLE, cursor - 2));
                    const slice = filtered.slice(start, start + MAX_VISIBLE);
                    return (
                      <Box flexDirection="column">
                        <Text dimColor>{'  candidates (↑↓ cycle, Enter to add):'}</Text>
                        {slice.map((name, i) => {
                          const absIdx = start + i;
                          const isCursor = absIdx === cursor;
                          return (
                            <Text key={name} color={isCursor ? PALETTE.info : undefined} dimColor={!isCursor}>
                              {isCursor ? `  ${figures.pointer} ${name}` : `    ${name}`}
                            </Text>
                          );
                        })}
                      </Box>
                    );
                  })()
                )}
              </Box>
            )}
        </Box>
      )}
    </Box>
  );
}

type PropField = 'type' | 'required' | 'description' | 'tokenKind' | 'allowed' | 'values' | 'default';
type SlotField = 'required' | 'description' | 'allowedComponents';
type PropDisplayGroup = 'content' | 'design' | 'hidden';
type SelectableRow = { kind: 'prop'; idx: number } | { kind: 'slot'; idx: number };

function propFields(prop: PropState): PropField[] {
  const fields: PropField[] = ['description', 'required', 'type'];
  if (prop.type === 'token') {
    fields.push('tokenKind');
  }
  if (prop.type === 'enum') fields.push('values');
  if (prop.type !== 'richtext' && prop.type !== 'media' && prop.type !== 'link') {
    fields.push('default');
  }
  if (prop.type === 'token' && prop.category === 'design') fields.push('allowed');
  return fields;
}
const SLOT_FIELDS: SlotField[] = ['description', 'required', 'allowedComponents'];

export function simulateGraphWithCandidate(
  projectSlotGraph: ComponentSlotInfo[],
  selfName: string,
  currentSlots: { name: string; allowedComponents: string[] }[],
  targetSlotName: string,
  candidate: string,
): ComponentSlotInfo[] {
  const selfEntry: ComponentSlotInfo = {
    name: selfName,
    slots: currentSlots.map((s) => ({
      name: s.name,
      allowedComponents: s.name === targetSlotName ? [...s.allowedComponents, candidate] : [...s.allowedComponents],
    })),
  };
  const withoutSelf = projectSlotGraph.filter((c) => c.name !== selfName);
  return [...withoutSelf, selfEntry];
}

export function introducesNewCycle(
  before: ReturnType<typeof findSlotCycles>,
  next: ReturnType<typeof findSlotCycles>,
): boolean {
  const key = (edges: { fromComponent: string; slotName: string; toComponent: string }[]): string => {
    if (edges.length === 0) return '';
    const encoded = edges.map((e) => `${e.fromComponent}|${e.slotName}|${e.toComponent}`);
    let minIdx = 0;
    for (let i = 1; i < encoded.length; i += 1) if (encoded[i] < encoded[minIdx]) minIdx = i;
    return [...encoded.slice(minIdx), ...encoded.slice(0, minIdx)].join(';');
  };
  const beforeSet = new Set(before.map((c) => key(c.edges)));
  for (const cycle of next) if (!beforeSet.has(key(cycle.edges))) return true;
  return false;
}

export function computeAllowedComponentCandidates(
  projectSlotGraph: ComponentSlotInfo[],
  selfName: string,
  currentSlots: { name: string; allowedComponents: string[] }[],
  targetSlotName: string,
): string[] {
  const targetSlot = currentSlots.find((s) => s.name === targetSlotName);
  const alreadyAdded = new Set(targetSlot?.allowedComponents ?? []);
  const universe = new Set<string>();
  for (const c of projectSlotGraph) universe.add(c.name);
  universe.delete(selfName);
  for (const added of alreadyAdded) universe.delete(added);
  const baseline = findSlotCycles(simulateGraphWithCandidate(projectSlotGraph, selfName, currentSlots, '', ''));
  const safe: string[] = [];
  for (const candidate of universe) {
    const nextCycles = findSlotCycles(
      simulateGraphWithCandidate(projectSlotGraph, selfName, currentSlots, targetSlotName, candidate),
    );
    if (!introducesNewCycle(baseline, nextCycles)) safe.push(candidate);
  }
  safe.sort((a, b) => a.localeCompare(b));
  return safe;
}

export function simulateGraphWithReplacement(
  projectSlotGraph: ComponentSlotInfo[],
  selfName: string,
  currentSlots: { name: string; allowedComponents: string[] }[],
  targetSlotName: string,
  replaceIndex: number,
  candidate: string,
): ComponentSlotInfo[] {
  const selfEntry: ComponentSlotInfo = {
    name: selfName,
    slots: currentSlots.map((s) => {
      if (s.name !== targetSlotName) return { name: s.name, allowedComponents: [...s.allowedComponents] };
      const nextVals = s.allowedComponents.map((v, i) => (i === replaceIndex ? candidate : v));
      return { name: s.name, allowedComponents: nextVals };
    }),
  };
  const withoutSelf = projectSlotGraph.filter((c) => c.name !== selfName);
  return [...withoutSelf, selfEntry];
}

export function computeAllowedComponentReplacementCandidates(
  projectSlotGraph: ComponentSlotInfo[],
  selfName: string,
  currentSlots: { name: string; allowedComponents: string[] }[],
  targetSlotName: string,
  replaceIndex: number,
): string[] {
  const targetSlot = currentSlots.find((s) => s.name === targetSlotName);
  const existing = targetSlot?.allowedComponents ?? [];
  const excludeOtherEntries = new Set<string>();
  existing.forEach((v, i) => {
    if (i !== replaceIndex) excludeOtherEntries.add(v);
  });
  const universe = new Set<string>();
  for (const c of projectSlotGraph) universe.add(c.name);
  universe.delete(selfName);
  for (const other of excludeOtherEntries) universe.delete(other);
  const baseline = findSlotCycles(simulateGraphWithCandidate(projectSlotGraph, selfName, currentSlots, '', ''));
  const safe: string[] = [];
  for (const candidate of universe) {
    const nextCycles = findSlotCycles(
      simulateGraphWithReplacement(projectSlotGraph, selfName, currentSlots, targetSlotName, replaceIndex, candidate),
    );
    if (!introducesNewCycle(baseline, nextCycles)) safe.push(candidate);
  }
  safe.sort((a, b) => a.localeCompare(b));
  return safe;
}

export function FieldEditor({
  value,
  width,
  height,
  fixedHeight = false,
  active = true,
  onChange,
  onSave,
  onDiscard,
  onExit,
  metadata,
  onTogglePropRationale,
  propRationaleKey = 'i',
  onToggleComponentRationale,
  componentRationaleKey = 'I',
  onToggleSourceExternal,
  onTextEntryActiveChange,
  projectSlotGraph,
  currentComponentName,
  onDirtyChange,
  discardTrigger,
  initialFocusTarget,
  showHiddenProps = true,
  showInlineRationales = true,
}: FieldEditorProps): React.ReactElement {
  const { state: initialState, error: parseError } = parseToState(value);

  const [editorState, setEditorState] = useState<EditorState>(initialState);
  const [parseErr] = useState<string | null>(parseError);
  const [listScrollStart, setListScrollStart] = useState(0);
  const initialFocusScrollApplied = React.useRef(false);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const rowMeasureRefs = React.useRef(new Map<string, DOMElement>());

  const initialFocus = (() => {
    if (initialFocusTarget?.kind === 'description') {
      return {
        focusLevel: 'componentDescription' as FocusLevel,
        inSlots: false,
        propIdx: 0,
        slotIdx: 0,
        activeField: null as PropField | SlotField | null,
        textCursor: 0,
      };
    }
    if (initialFocusTarget?.kind === 'prop') {
      const idx = initialState.props.findIndex((p) => p.name === initialFocusTarget.name);
      if (idx >= 0) {
        return {
          focusLevel: 'prop' as FocusLevel,
          inSlots: false,
          propIdx: idx,
          slotIdx: 0,
          activeField: null as PropField | SlotField | null,
          textCursor: 0,
        };
      }
    }
    if (initialFocusTarget?.kind === 'slot') {
      const idx = initialState.slots.findIndex((s) => s.name === initialFocusTarget.name);
      if (idx >= 0) {
        return {
          focusLevel: 'slot' as FocusLevel,
          inSlots: true,
          propIdx: 0,
          slotIdx: idx,
          activeField: null as PropField | SlotField | null,
          textCursor: 0,
        };
      }
    }
    if (initialState.props.length > 0) {
      return {
        focusLevel: 'prop' as FocusLevel,
        inSlots: false,
        propIdx: 0,
        slotIdx: 0,
        activeField: null as PropField | SlotField | null,
        textCursor: 0,
      };
    }
    if (initialState.slots.length > 0) {
      return {
        focusLevel: 'slot' as FocusLevel,
        inSlots: true,
        propIdx: 0,
        slotIdx: 0,
        activeField: null as PropField | SlotField | null,
        textCursor: 0,
      };
    }
    return {
      focusLevel: 'prop' as FocusLevel,
      inSlots: false,
      propIdx: 0,
      slotIdx: 0,
      activeField: null as PropField | SlotField | null,
      textCursor: 0,
    };
  })();

  const [focusLevel, setFocusLevel] = useState<FocusLevel>(initialFocus.focusLevel);
  const [propIdx, setPropIdx] = useState(initialFocus.propIdx);
  const [slotIdx, setSlotIdx] = useState(initialFocus.slotIdx);
  const [inSlots, setInSlots] = useState(initialFocus.inSlots);
  const [inComponentDesc, setInComponentDesc] = useState(initialFocus.focusLevel === 'componentDescription');
  const [activeField, setActiveField] = useState<PropField | SlotField | null>(initialFocus.activeField);
  const [editingField, setEditingField] = useState(false);
  const [textCursor, setTextCursor] = useState(initialFocus.textCursor);
  const [valueCursor, setValueCursor] = useState(0);
  const [editingValue, setEditingValue] = useState<EditingValue | null>(null);
  const [valueText, setValueText] = useState('');
  const [pickerCursor, setPickerCursor] = useState(0);

  const [validationError, setValidationError] = useState<string | null>(null);
  const [cursorVisible] = useState(true);

  const [sourceOpen, setSourceOpen] = useState(false);

  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [rationaleScrollOffset, setRationaleScrollOffset] = useState(0);

  const [showHelp, setShowHelp] = useState(false);

  const props = editorState.props;
  const slots = editorState.slots;
  // Filter and group the view only so saving preserves hidden properties.
  const contentPropIndexes = React.useMemo(
    () => props.flatMap((prop, index) => (prop.category === 'content' ? [index] : [])),
    [props],
  );
  const designPropIndexes = React.useMemo(
    () => props.flatMap((prop, index) => (prop.category === 'design' ? [index] : [])),
    [props],
  );
  const hiddenPropIndexes = React.useMemo(
    () =>
      showHiddenProps
        ? props.flatMap((prop, index) => (prop.category === 'state' || prop.category === 'unattached' ? [index] : []))
        : [],
    [props, showHiddenProps],
  );
  const visiblePropIndexes = React.useMemo(
    () => [...contentPropIndexes, ...designPropIndexes, ...hiddenPropIndexes],
    [contentPropIndexes, designPropIndexes, hiddenPropIndexes],
  );
  const propGroups = React.useMemo(
    () => [
      {
        kind: 'content' as const,
        label: '── CONTENT PROPERTIES',
        indexes: contentPropIndexes,
      },
      {
        kind: 'design' as const,
        label: '── DESIGN PROPERTIES',
        indexes: designPropIndexes,
      },
      {
        kind: 'hidden' as const,
        label: '── OTHER / HIDDEN',
        indexes: hiddenPropIndexes,
      },
    ],
    [contentPropIndexes, designPropIndexes, hiddenPropIndexes],
  );
  const selectableRows = React.useMemo<SelectableRow[]>(
    () => [
      ...contentPropIndexes.map((idx) => ({ kind: 'prop' as const, idx })),
      ...designPropIndexes.map((idx) => ({ kind: 'prop' as const, idx })),
      ...slots.map((_, idx) => ({ kind: 'slot' as const, idx })),
      ...hiddenPropIndexes.map((idx) => ({ kind: 'prop' as const, idx })),
    ],
    [contentPropIndexes, designPropIndexes, hiddenPropIndexes, slots],
  );
  const visiblePropPosition = visiblePropIndexes.indexOf(propIdx);
  const selectedSelectableIndex = React.useMemo(
    () =>
      selectableRows.findIndex((row) =>
        inSlots ? row.kind === 'slot' && row.idx === slotIdx : row.kind === 'prop' && row.idx === propIdx,
      ),
    [inSlots, propIdx, selectableRows, slotIdx],
  );

  const focusSelectableRow = (row: SelectableRow) => {
    setInComponentDesc(false);
    if (row.kind === 'prop') {
      setInSlots(false);
      setPropIdx(row.idx);
      setFocusLevel('prop');
    } else {
      setInSlots(true);
      setSlotIdx(row.idx);
      setFocusLevel('slot');
    }
  };

  const textEntryActive =
    (focusLevel === 'field' && editingField && activeField === 'description') ||
    (focusLevel === 'field' &&
      editingField &&
      activeField === 'default' &&
      (editorState.props[propIdx]?.type === 'string' || editorState.props[propIdx]?.type === 'token')) ||
    editingValue != null;
  React.useEffect(() => {
    onTextEntryActiveChange?.(textEntryActive);
  }, [textEntryActive, onTextEntryActiveChange]);

  const currentProp = props[propIdx] ?? null;
  const currentSlot = slots[slotIdx] ?? null;

  React.useEffect(() => {
    if (showHiddenProps || inSlots || inComponentDesc || visiblePropPosition >= 0) return;

    if (visiblePropIndexes.length > 0) {
      setPropIdx(visiblePropIndexes[0]!);
      return;
    }
    if (slots.length > 0) {
      setInSlots(true);
      setSlotIdx(0);
      setFocusLevel('slot');
      return;
    }
    setInComponentDesc(true);
    setFocusLevel('componentDescription');
  }, [inComponentDesc, inSlots, showHiddenProps, slots.length, visiblePropIndexes, visiblePropPosition]);

  const commit = (next: EditorState) => {
    setEditorState(next);
    onChange(serializeState(next, value));
  };

  const canonicalize = React.useCallback((json: string): string => {
    try {
      return JSON.stringify(JSON.parse(json));
    } catch {
      return `__unparseable__:${json}`;
    }
  }, []);
  const initialStateRef = React.useRef<EditorState>(initialState);
  const baselineCanonical = canonicalize(serializeState(initialStateRef.current, value));
  const currentCanonical = canonicalize(serializeState(editorState, value));
  const isDirty = currentCanonical !== baselineCanonical;
  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const lastDiscardTriggerRef = React.useRef<number | undefined>(discardTrigger);
  React.useEffect(() => {
    if (discardTrigger === undefined) return;
    if (discardTrigger === lastDiscardTriggerRef.current) return;
    lastDiscardTriggerRef.current = discardTrigger;
    setEditorState(initialStateRef.current);
    onChange(serializeState(initialStateRef.current, value));
  }, [discardTrigger, onChange, value]);

  useImmediateInput((input, key) => {
    if (!active) return;

    if (showHelp) {
      if (input === 'h' || key.escape) {
        setShowHelp(false);
      }
      return;
    }
    if (key.ctrl && input === 's') {
      initialStateRef.current = editorState;
      onDirtyChange?.(false);
      onSave();
      return;
    }
    const inDescriptionTextEntryForHelp = focusLevel === 'field' && editingField && activeField === 'description';
    const inStringDefaultTextEntryForHelp =
      focusLevel === 'field' &&
      editingField &&
      activeField === 'default' &&
      currentProp != null &&
      (currentProp.type === 'string' || currentProp.type === 'token');
    const inValueListTextEntry = editingValue != null;
    if (
      input === 'h' &&
      !key.ctrl &&
      !key.meta &&
      !inDescriptionTextEntryForHelp &&
      !inStringDefaultTextEntryForHelp &&
      !inValueListTextEntry
    ) {
      setShowHelp(true);
      return;
    }

    const isPropValuesEntry = editingValue && currentProp && activeField === 'values' && !inSlots;
    const isSlotAllowedEntry = editingValue && currentSlot && activeField === 'allowedComponents' && inSlots;
    const slotAddCandidates =
      isSlotAllowedEntry && editingValue?.mode === 'add' && projectSlotGraph && currentSlot && currentComponentName
        ? computeAllowedComponentCandidates(projectSlotGraph, currentComponentName, slots, currentSlot.name)
        : null;
    const filteredCandidates = slotAddCandidates
      ? valueText.length === 0
        ? slotAddCandidates
        : slotAddCandidates.filter((n) => n.toLowerCase().includes(valueText.toLowerCase()))
      : null;
    if (isPropValuesEntry || isSlotAllowedEntry) {
      const vals = isPropValuesEntry ? currentProp!.values : currentSlot!.allowedComponents;
      const pickerActive = isSlotAllowedEntry && editingValue?.mode === 'add' && slotAddCandidates !== null;
      if (pickerActive && (key.upArrow || key.downArrow)) {
        const len = filteredCandidates!.length;
        if (len > 0) {
          setPickerCursor((c) => (key.upArrow ? (c - 1 + len) % len : (c + 1) % len));
        }
        return;
      }
      if (key.return) {
        let chosen: string | null = null;
        if (pickerActive && filteredCandidates && filteredCandidates.length > 0) {
          if (valueText.trim() === '') {
            chosen = filteredCandidates[pickerCursor % filteredCandidates.length] ?? null;
          } else {
            const exact = filteredCandidates.find((n) => n === valueText.trim());
            if (exact) chosen = exact;
          }
        }
        const trimmed = chosen ?? valueText.trim();
        if (trimmed) {
          if (
            isSlotAllowedEntry &&
            editingValue?.mode === 'add' &&
            projectSlotGraph &&
            currentSlot &&
            currentComponentName &&
            chosen === null
          ) {
            if (trimmed === currentComponentName) {
              setValidationError(`"${trimmed}" cannot be added to its own slot (self-loop).`);
              return;
            }
            const baseline = findSlotCycles(
              simulateGraphWithCandidate(projectSlotGraph, currentComponentName, slots, '', ''),
            );
            const next = findSlotCycles(
              simulateGraphWithCandidate(projectSlotGraph, currentComponentName, slots, currentSlot.name, trimmed),
            );
            if (introducesNewCycle(baseline, next)) {
              setValidationError(
                `Adding "${trimmed}" to slot "${currentSlot.name}" would create a slot-dependency cycle. Choose a different component.`,
              );
              return;
            }
          }
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
          setValidationError(null);
        }
        setEditingValue(null);
        setValueText('');
        setPickerCursor(0);
        return;
      }
      if (key.escape) {
        setEditingValue(null);
        setValueText('');
        setPickerCursor(0);
        setValidationError(null);
        return;
      }
      if (key.backspace) {
        setValueText((t) => t.slice(0, -1));
        setPickerCursor(0);
        return;
      }
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        setValueText((t) => t + input);
        setPickerCursor(0);
        return;
      }
      return;
    }

    const inDescriptionTextEntry = focusLevel === 'field' && editingField && activeField === 'description';
    const inComponentDescTextEntry =
      focusLevel === 'field' && editingField && inComponentDesc && activeField === 'description';
    if (input === 's' && !key.ctrl && !key.meta && !inDescriptionTextEntry && !inComponentDescTextEntry) {
      if (onToggleSourceExternal) {
        onToggleSourceExternal();
        return;
      }
      setRationaleOpen(false);
      setRationaleScrollOffset(() => 0);
      setSourceOpen((o) => !o);
      return;
    }

    if (rationaleOpen && !onTogglePropRationale) {
      const PANEL_HEIGHT = 12;
      const next = computeNextScrollOffset(rationaleScrollOffset, input, key, 9999, PANEL_HEIGHT);
      if (next !== null) {
        setRationaleScrollOffset(() => next);
        return;
      }
      if (input === 'i' || key.escape) {
        setRationaleOpen(false);
        setRationaleScrollOffset(() => 0);
        return;
      }
      return;
    }

    const inStringDefaultTextEntry =
      focusLevel === 'field' &&
      editingField &&
      activeField === 'default' &&
      currentProp != null &&
      (currentProp.type === 'string' || currentProp.type === 'token');
    const rationaleKeyAllowed =
      !key.ctrl &&
      !key.meta &&
      !inDescriptionTextEntry &&
      !inComponentDescTextEntry &&
      !inStringDefaultTextEntry &&
      !inValueListTextEntry;
    if (input === propRationaleKey && rationaleKeyAllowed && onTogglePropRationale) {
      onTogglePropRationale();
      return;
    }
    if (input === 'i' && rationaleKeyAllowed && !onTogglePropRationale) {
      setSourceOpen(false);
      setRationaleScrollOffset(() => 0);
      setRationaleOpen((o) => !o);
      return;
    }
    if (input === componentRationaleKey && rationaleKeyAllowed && onToggleComponentRationale) {
      onToggleComponentRationale();
      return;
    }

    if (key.escape && sourceOpen) {
      setSourceOpen(false);
      return;
    }

    if (key.escape) {
      if (focusLevel === 'field') {
        if (editingField) {
          // Leaving a text field is an edit exit, not a cancellation. Persist
          // the current draft before returning to field navigation.
          initialStateRef.current = editorState;
          onDirtyChange?.(false);
          onSave();
          setEditingField(false);
        } else {
          if (inComponentDesc) setFocusLevel('componentDescription');
          else setFocusLevel(inSlots ? 'slot' : 'prop');
          setActiveField(null);
        }
        return;
      }
      if (onExit) {
        onExit();
      } else {
        onDiscard();
      }
      return;
    }

    if (focusLevel === 'componentDescription') {
      if (key.upArrow) {
        return;
      }
      if (key.downArrow) {
        const firstSelectableRow = selectableRows[0];
        if (firstSelectableRow) focusSelectableRow(firstSelectableRow);
        return;
      }
      if (key.return) {
        setFocusLevel('field');
        setActiveField('description');
        setEditingField(false);
        setTextCursor(editorState.componentDescription.length);
        return;
      }
      return;
    }

    if (focusLevel === 'prop' || focusLevel === 'slot') {
      const rowPrevious = key.upArrow || input === 'k';
      const rowNext = key.downArrow || input === 'j';
      if (rowPrevious) {
        if (selectedSelectableIndex > 0) {
          focusSelectableRow(selectableRows[selectedSelectableIndex - 1]!);
        } else if (selectedSelectableIndex === 0) {
          setFocusLevel('componentDescription');
          setInSlots(false);
          setInComponentDesc(true);
        }
        return;
      }
      if (rowNext) {
        if (selectedSelectableIndex >= 0 && selectedSelectableIndex < selectableRows.length - 1) {
          focusSelectableRow(selectableRows[selectedSelectableIndex + 1]!);
        }
        return;
      }
      if (focusLevel === 'slot' && key.return && currentSlot) {
        setFocusLevel('field');
        setActiveField(SLOT_FIELDS[0] ?? null);
        setEditingField(false);
        setTextCursor(currentSlot.description.length);
        return;
      }
      if (focusLevel === 'prop' && key.return && currentProp) {
        setFocusLevel('field');
        setActiveField(propFields(currentProp)[0] ?? null);
        setEditingField(false);
        setTextCursor(currentProp.description.length);
        return;
      }
      return;
    }

    if (focusLevel === 'field') {
      const fields = inSlots ? SLOT_FIELDS : currentProp ? propFields(currentProp) : [];
      const currentFieldIdx = fields.indexOf(activeField as never);
      const isValuesNav = activeField === 'values' || activeField === 'allowedComponents';
      const arrowUp = key.upArrow;
      const arrowDown = key.downArrow;
      const arrowLeft = key.leftArrow;
      const arrowRight = key.rightArrow;

      if (!editingField) {
        if (key.return) {
          setEditingField(true);
          return;
        }
        const navPrevious = arrowUp || arrowLeft;
        const navNext = arrowDown || arrowRight || input === 'j';
        const navBack = navPrevious || input === 'k';
        if ((navBack || navNext) && fields.length > 0) {
          const lastIdx = fields.length - 1;
          const targetIdx = navNext
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
            const cur = typeof currentProp.default === 'string' ? currentProp.default : '';
            setTextCursor(cur.length);
          } else if (next === 'values' || next === 'allowedComponents') {
            const nextVals =
              next === 'values' && currentProp
                ? currentProp.values
                : next === 'allowedComponents' && currentSlot
                  ? currentSlot.allowedComponents
                  : [];
            setValueCursor(navNext ? 0 : Math.max(0, nextVals.length - 1));
          }
        }
        return;
      }

      if (key.return) {
        setEditingField(false);
        return;
      }

      if (isValuesNav) {
        const vals =
          activeField === 'values' && currentProp
            ? currentProp.values
            : activeField === 'allowedComponents' && currentSlot
              ? currentSlot.allowedComponents
              : null;
        if (vals !== null) {
          // Move the value cursor within the list. At a boundary, fall through to
          // field navigation so the field itself is escapable (e.g. reach the
          // slot `description` field past `allowedComponents`).
          if (arrowUp) {
            if (valueCursor > 0) {
              setValueCursor((c) => Math.max(0, c - 1));
              return;
            }
          } else if (arrowDown) {
            if (valueCursor < vals.length - 1) {
              setValueCursor((c) => Math.min(vals.length - 1, c + 1));
              return;
            }
          }
        }
      }

      if (activeField === 'type' && (key.leftArrow || key.rightArrow) && currentProp) {
        const options = CDF_PROPERTY_TYPES as readonly string[];
        const idx = options.indexOf(currentProp.type);
        const next = key.leftArrow
          ? options[(idx - 1 + options.length) % options.length]
          : options[(idx + 1) % options.length];
        const updated = { ...currentProp, type: next as PropState['type'] };
        if (next === 'token') {
          updated.category = 'design';
          updated.tokenKind ||= DESIGN_TOKEN_TYPES[0] ?? '';
        } else {
          updated.tokenKind = '';
        }
        if (next !== 'enum') updated.values = [];
        const nextProps = props.map((p, i) => (i === propIdx ? updated : p));
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

      if (activeField === 'default' && currentProp) {
        const setProp = (next: PropState) => {
          const nextProps = props.map((p, i) => (i === propIdx ? next : p));
          commit({ ...editorState, props: nextProps });
        };

        if (currentProp.type === 'boolean' && (key.leftArrow || key.rightArrow)) {
          const cycle: (boolean | null)[] = [null, true, false];
          const curIdx = cycle.findIndex((v) => v === currentProp.default);
          const idx = curIdx < 0 ? 0 : curIdx;
          const nextIdx = key.rightArrow ? (idx + 1) % cycle.length : (idx - 1 + cycle.length) % cycle.length;
          setProp({ ...currentProp, default: cycle[nextIdx]! });
          return;
        }

        if (currentProp.type === 'enum' && (key.leftArrow || key.rightArrow)) {
          const opts: (string | null)[] = [null, ...currentProp.values];
          const cur = typeof currentProp.default === 'string' ? currentProp.default : null;
          const curIdx = opts.findIndex((v) => v === cur);
          const idx = curIdx < 0 ? 0 : curIdx;
          const nextIdx = key.rightArrow ? (idx + 1) % opts.length : (idx - 1 + opts.length) % opts.length;
          setProp({ ...currentProp, default: opts[nextIdx] });
          return;
        }

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

      const currentValueList =
        activeField === 'allowedComponents' && currentSlot
          ? currentSlot.allowedComponents
          : activeField === 'values' && currentProp
            ? currentProp.values
            : null;
      const setCurrentValueList = (next: string[]) => {
        if (activeField === 'allowedComponents' && currentSlot) {
          const nextSlots = slots.map((s, i) => (i === slotIdx ? { ...s, allowedComponents: next } : s));
          commit({ ...editorState, slots: nextSlots });
        } else if (activeField === 'values' && currentProp) {
          const nextProps = props.map((p, i) => (i === propIdx ? { ...p, values: next } : p));
          commit({ ...editorState, props: nextProps });
        }
      };

      if (currentValueList) {
        if (input === 'a') {
          setEditingValue({ mode: 'add' });
          setValueText('');
          return;
        }

        if (input === 'e' && currentValueList.length > 0) {
          setEditingValue({ mode: 'edit', index: valueCursor });
          setValueText(currentValueList[valueCursor] ?? '');
          return;
        }

        if (input === 'r' && currentValueList.length > 0) {
          const nextVals = removeAt(currentValueList, valueCursor);
          setCurrentValueList(nextVals);
          setValueCursor((c) => Math.max(0, Math.min(c, nextVals.length - 1)));
          return;
        }

        if (key.shift && key.upArrow && valueCursor > 0) {
          const nextVals = swapValues(currentValueList, valueCursor - 1, valueCursor);
          setCurrentValueList(nextVals);
          setValueCursor((c) => c - 1);
          return;
        }

        if (key.shift && key.downArrow && valueCursor < currentValueList.length - 1) {
          const nextVals = swapValues(currentValueList, valueCursor, valueCursor + 1);
          setCurrentValueList(nextVals);
          setValueCursor((c) => c + 1);
          return;
        }

        if (input === 'K' && valueCursor > 0) {
          const nextVals = swapValues(currentValueList, valueCursor - 1, valueCursor);
          setCurrentValueList(nextVals);
          setValueCursor((c) => c - 1);
          return;
        }
        if (input === 'J' && valueCursor < currentValueList.length - 1) {
          const nextVals = swapValues(currentValueList, valueCursor, valueCursor + 1);
          setCurrentValueList(nextVals);
          setValueCursor((c) => c + 1);
          return;
        }
      }

      if (activeField === 'allowedComponents' && currentSlot) {
        const vals = currentSlot.allowedComponents;
        if (
          (key.leftArrow || key.rightArrow || input === 'h' || input === 'l') &&
          vals.length > 0 &&
          projectSlotGraph &&
          currentComponentName
        ) {
          const candidates = computeAllowedComponentReplacementCandidates(
            projectSlotGraph,
            currentComponentName,
            slots,
            currentSlot.name,
            valueCursor,
          );
          if (candidates.length === 0) {
            setValidationError('no other valid components for this position');
            return;
          }
          const current = vals[valueCursor] ?? '';
          const curIdx = candidates.indexOf(current);
          const forward = key.rightArrow || input === 'l';
          const baseIdx = curIdx < 0 ? (forward ? -1 : 0) : curIdx;
          const nextIdx = forward
            ? (baseIdx + 1) % candidates.length
            : (baseIdx - 1 + candidates.length) % candidates.length;
          const next = candidates[nextIdx];
          if (next === undefined || next === current) return;
          const nextVals = vals.map((v, i) => (i === valueCursor ? next : v));
          setCurrentValueList(nextVals);
          setValidationError(null);
          return;
        }
      }

      return;
    }
  });

  const innerWidth = Math.max(1, width - 2);

  if (parseErr) {
    return (
      <Box flexDirection="column" width={width} borderStyle="single" borderColor={PALETTE.error}>
        <Text bold color={PALETTE.error}>
          FIELD EDITOR — parse error
        </Text>
        <Text color={PALETTE.error}>{parseErr}</Text>
        <Text dimColor>Cannot display structured editor. Fix the JSON first.</Text>
      </Box>
    );
  }

  if (props.length === 0 && slots.length === 0) {
    return (
      <Box flexDirection="column" width={width} borderStyle="single" borderColor={PALETTE.warning}>
        <Text bold color={PALETTE.warning}>
          FIELD EDITOR — no fields
        </Text>
        <Text color={PALETTE.warning}>
          {"⚠ No properties classified for this component. The LLM didn't find anything to classify."}
        </Text>
        <Text dimColor>You can add fields manually below or reject this component.</Text>
        <Text dimColor>Enter to save · Esc to discard</Text>
      </Box>
    );
  }

  const hasEmptyProperties = props.length === 0 && slots.length === 0;

  const modeLabel = (() => {
    if (editingValue) {
      return editingValue.mode === 'add' ? 'Enter to add · Esc to cancel' : 'Enter to save edit · Esc to cancel';
    }
    if (focusLevel === 'field' && editingField && activeField === 'description') {
      return 'Type to edit  ←→ cursor  ↑↓ cycle field  Esc row  Enter save';
    }
    if (focusLevel === 'field' && editingField && (activeField === 'type' || activeField === 'tokenKind')) {
      return '←→ cycle value  ↑↓/←→ cycle field  Esc row';
    }
    if (focusLevel === 'field' && editingField && activeField === 'required') {
      return 'Space toggle  Enter save  Esc back';
    }
    if (focusLevel === 'field' && editingField && (activeField === 'values' || activeField === 'allowedComponents')) {
      return '[a]dd  [e]dit  [r]emove  ↑↓ navigate  Shift+↑/↓ reorder  Esc row';
    }
    if (focusLevel === 'field' && !editingField) {
      return '↑↓/←→ navigate fields  Enter edit  Esc back';
    }
    if (rationaleOpen) {
      return '↑↓/Ctrl+u/d scroll  i/Esc close  rationale panel';
    }
    return `[↑↓] navigate rows  [Enter] edit fields  [s] source  [${propRationaleKey}] prop rationale  [${componentRationaleKey}] component rationale  [h] help  [Esc] exit panel`;
  })();

  type Row =
    | { kind: 'header'; label: string; section: PropDisplayGroup | 'slots' }
    | { kind: 'prop'; idx: number }
    | { kind: 'slot'; idx: number }
    | { kind: 'component-description' };

  const rows: Row[] = [];
  rows.push({ kind: 'component-description' });
  for (const group of propGroups.filter((candidate) => candidate.kind !== 'hidden')) {
    if (group.indexes.length === 0) continue;
    rows.push({
      kind: 'header',
      label: `${group.label} (${group.indexes.length}) `,
      section: group.kind,
    });
    group.indexes.forEach((idx) => rows.push({ kind: 'prop', idx }));
  }
  if (slots.length > 0) {
    rows.push({
      kind: 'header',
      label: `── SLOTS (${slots.length}) `,
      section: 'slots',
    });
    slots.forEach((_, i) => rows.push({ kind: 'slot', idx: i }));
  }
  const hiddenGroup = propGroups.find((group) => group.kind === 'hidden');
  if (hiddenGroup && hiddenGroup.indexes.length > 0) {
    rows.push({
      kind: 'header',
      label: `${hiddenGroup.label} (${hiddenGroup.indexes.length}) `,
      section: 'hidden',
    });
    hiddenGroup.indexes.forEach((idx) => rows.push({ kind: 'prop', idx }));
  }

  const selectedRowIdx = rows.findIndex(
    (r) =>
      (r.kind === 'prop' && !inSlots && !inComponentDesc && r.idx === propIdx) ||
      (r.kind === 'slot' && inSlots && r.idx === slotIdx) ||
      (r.kind === 'component-description' && inComponentDesc),
  );
  const rowKey = (row: Row, index: number): string => {
    const selected =
      (row.kind === 'prop' && !inSlots && !inComponentDesc && row.idx === propIdx) ||
      (row.kind === 'slot' && inSlots && row.idx === slotIdx) ||
      (row.kind === 'component-description' && inComponentDesc);
    const base =
      row.kind === 'component-description' || row.kind === 'header' ? `${row.kind}-${index}` : `${row.kind}-${row.idx}`;
    return `${base}-${selected ? 'selected' : 'normal'}`;
  };
  const rowHeight = (row: Row, index: number): number => rowHeights[rowKey(row, index)] ?? 1;
  const contentHeight = Math.max(1, height - 2 - (hasEmptyProperties ? 1 : 0) - 1);
  const visibleEnd = (start: number): number => {
    if (focusLevel === 'field') return Math.min(rows.length, start + 1);
    let used = 0;
    let end = start;
    while (end < rows.length) {
      const nextHeight = rowHeight(rows[end]!, end);
      if (end > start && used + nextHeight > contentHeight) break;
      used += nextHeight;
      end += 1;
    }
    return Math.max(start + 1, end);
  };

  useEffect(() => {
    if (focusLevel === 'field' || selectedRowIdx < 0) return;
    setListScrollStart((previous) => {
      if (initialFocusTarget && !initialFocusScrollApplied.current) {
        initialFocusScrollApplied.current = true;
        return Math.min(selectedRowIdx, Math.max(0, rows.length - 1));
      }
      const clamped = Math.min(previous, Math.max(0, rows.length - 1));
      const end = visibleEnd(clamped);
      if (selectedRowIdx < clamped) return selectedRowIdx;
      if (selectedRowIdx >= end) {
        let start = selectedRowIdx;
        let used = rowHeight(rows[selectedRowIdx]!, selectedRowIdx);
        while (start > 0) {
          const previousHeight = rowHeight(rows[start - 1]!, start - 1);
          if (used + previousHeight > contentHeight) break;
          start -= 1;
          used += previousHeight;
        }
        return start;
      }
      return clamped;
    });
  }, [contentHeight, focusLevel, rowHeights, rows, selectedRowIdx]);
  const scrollStart = Math.min(listScrollStart, Math.max(0, rows.length - 1));
  const end = visibleEnd(scrollStart);
  const nextHeader = rows.slice(end).find((row) => row.kind === 'header');
  const categoryBelow =
    focusLevel !== 'field' && nextHeader?.kind === 'header' ? nextHeader.label.replace(/^──\s*/, '').trim() : null;
  const visibleRowSlice = rows.slice(scrollStart, end);

  useLayoutEffect(() => {
    const nextHeights: Record<string, number> = {};
    for (const [key, node] of rowMeasureRefs.current) {
      const measuredHeight = measureElement(node).height;
      if (measuredHeight > 0) nextHeights[key] = measuredHeight;
    }
    setRowHeights((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const [key, height] of Object.entries(nextHeights)) {
        if (next[key] !== height) {
          next[key] = height;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  });

  const focusedSlotPickerCandidates =
    focusLevel === 'field' &&
    inSlots &&
    editingValue?.mode === 'add' &&
    activeField === 'allowedComponents' &&
    projectSlotGraph &&
    currentComponentName &&
    currentSlot
      ? computeAllowedComponentCandidates(projectSlotGraph, currentComponentName, slots, currentSlot.name)
      : null;

  const renderRow = (row: Row, index: number): React.ReactElement => {
    const key = rowKey(row, index);
    if (row.kind === 'header') {
      return (
        <Box key={key} flexDirection="column" paddingTop={1}>
          <Text bold color={PALETTE.success}>
            {row.label}
          </Text>
        </Box>
      );
    }
    if (row.kind === 'component-description') {
      const isSelected = inComponentDesc && active;
      const isEditing = isSelected && focusLevel === 'field' && editingField && activeField === 'description';
      return (
        <DescriptionField
          key={key}
          value={editorState.componentDescription}
          focused={isSelected}
          editing={isEditing}
          textCursor={textCursor}
          cursorVisible={cursorVisible}
          width={innerWidth}
          label="description:"
          compact={!isEditing}
          paddingLeft={0}
        />
      );
    }
    if (row.kind === 'prop') {
      const p = props[row.idx]!;
      const isSelected = active && !inSlots && !inComponentDesc && row.idx === propIdx;
      const propMeta = metadata?.props?.[p.name];
      const commonRowProps = createCommonRowProps(
        isSelected,
        focusLevel,
        editingField,
        textCursor,
        valueCursor,
        cursorVisible,
        editingValue,
        valueText,
        innerWidth,
      );
      return (
        <PropRow
          key={key}
          prop={p}
          {...commonRowProps}
          activeField={isSelected && focusLevel === 'field' ? (activeField as PropField) : null}
          rationale={propMeta?.rationale ?? null}
          showRationale={showInlineRationales}
          rowKey={String(row.idx)}
        />
      );
    }
    const s = slots[row.idx]!;
    const isSelected = active && inSlots && row.idx === slotIdx;
    const slotPickerCandidates =
      isSelected &&
      editingValue?.mode === 'add' &&
      activeField === 'allowedComponents' &&
      projectSlotGraph &&
      currentComponentName
        ? computeAllowedComponentCandidates(projectSlotGraph, currentComponentName, slots, s.name)
        : null;
    const commonRowProps = createCommonRowProps(
      isSelected,
      focusLevel,
      editingField,
      textCursor,
      valueCursor,
      cursorVisible,
      editingValue,
      valueText,
      innerWidth,
    );
    return (
      <SlotRow
        key={key}
        slot={s}
        {...commonRowProps}
        activeField={isSelected && focusLevel === 'field' ? (activeField as SlotField) : null}
        pickerCandidates={slotPickerCandidates}
        pickerCursor={pickerCursor}
      />
    );
  };

  return (
    <FixedPanel
      width={width}
      {...(fixedHeight ? { height } : { minHeight: height })}
      clipOverflow={fixedHeight}
      borderStyle="single"
      borderColor={hasEmptyProperties ? PALETTE.warning : active ? PALETTE.info : PALETTE.border}
    >
      {hasEmptyProperties && (
        <Text color={PALETTE.warning}>
          {
            "⚠ No properties classified for this component. The LLM didn't find anything to classify. Reject this component or add fields manually."
          }
        </Text>
      )}

      <Box flexDirection="column" width={innerWidth} flexShrink={0}>
        {focusLevel === 'field' && !inComponentDesc && currentProp ? (
          <PropRow
            prop={currentProp}
            selected
            activeField={activeField as PropField}
            editingField={editingField}
            textCursor={textCursor}
            valueCursor={valueCursor}
            cursorVisible={cursorVisible}
            editingValue={editingValue}
            valueText={valueText}
            width={innerWidth}
            rationale={metadata?.props?.[currentProp.name]?.rationale ?? null}
            showRationale={showInlineRationales}
          />
        ) : focusLevel === 'field' && inSlots && currentSlot ? (
          <SlotRow
            slot={currentSlot}
            selected
            activeField={activeField as SlotField}
            editingField={editingField}
            textCursor={textCursor}
            valueCursor={valueCursor}
            cursorVisible={cursorVisible}
            editingValue={editingValue}
            valueText={valueText}
            width={innerWidth}
            pickerCandidates={focusedSlotPickerCandidates}
            pickerCursor={pickerCursor}
          />
        ) : (
          visibleRowSlice.map((row, index) => {
            const absoluteIndex = scrollStart + index;
            const key = rowKey(row, absoluteIndex);
            return (
              <Box
                key={`visible-${key}`}
                ref={(node) => {
                  if (node) rowMeasureRefs.current.set(key, node);
                  else rowMeasureRefs.current.delete(key);
                }}
                width={innerWidth}
                flexShrink={0}
              >
                {renderRow(row, absoluteIndex)}
              </Box>
            );
          })
        )}
      </Box>
      {categoryBelow && <Text color={PALETTE.success} bold>{`(${categoryBelow} below)`}</Text>}

      {sourceOpen &&
        !onToggleSourceExternal &&
        (() => {
          const propMeta =
            !inSlots && !inComponentDesc && currentProp ? metadata?.props?.[currentProp.name] : undefined;
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

      {showHelp && (
        <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.info} paddingX={1}>
          <Text bold color={PALETTE.info}>
            Keybindings
          </Text>
          <Text> </Text>
          <Text bold>Row navigation</Text>
          <Text>{'  ↑/↓               move between rows'}</Text>
          <Text>{'  Enter            edit fields on the current row'}</Text>
          <Text>{'  Esc              exit the panel'}</Text>
          <Text> </Text>
          <Text bold>Field editing</Text>
          <Text>{'  ↑/↓/←→           cycle through fields'}</Text>
          <Text>{'  ←/→              cycle picker values · move cursor in text inputs'}</Text>
          <Text>{'  Space/Enter      toggle required'}</Text>
          <Text>{'  Type             edit description / string default'}</Text>
          <Text>{'  Esc              exit field-edit back to the row'}</Text>
          <Text> </Text>
          <Text bold>Values / allowedComponents</Text>
          <Text>{'  a / e / r        add · edit · remove'}</Text>
          <Text>{'  ↑↓               navigate the list'}</Text>
          <Text>{'  K / J            reorder up · down'}</Text>
          <Text> </Text>
          <Text bold>Panels</Text>
          <Text>{'  s                toggle source-view for the current prop'}</Text>
          <Text>{'  ' + propRationaleKey.padEnd(16) + ' toggle prop rationale panel'}</Text>
          <Text>{'  ' + componentRationaleKey.padEnd(16) + ' toggle component rationale panel'}</Text>
          <Text>{'  ?                toggle this overlay'}</Text>
          <Text> </Text>
          <Text dimColor>press ? or Esc to close</Text>
        </Box>
      )}
      {validationError && <Text color={PALETTE.error}>{'✗ ' + validationError}</Text>}
      <Box paddingTop={1}>
        <Text dimColor>{modeLabel}</Text>
      </Box>
    </FixedPanel>
  );
}

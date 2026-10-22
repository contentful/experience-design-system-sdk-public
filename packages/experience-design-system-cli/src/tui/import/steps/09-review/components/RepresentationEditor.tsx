import React, { useState } from 'react';
import { Box, Text } from 'ink';
import {
  cloneJson,
  parseStrictJson,
  type CDFComponentEntry,
  type RepresentationPlan,
} from '@contentful/experience-design-system-types';
import { useImmediateInput } from '../../07-scope-gate/sidebar/hooks/useImmediateInput.js';
import { FieldEditor } from './FieldEditor.js';
import { PALETTE } from '@tui/theme.js';

type RepresentationView = 'models' | 'mappings' | 'relationships' | 'requirements';
type RepresentationRow = { id: string; label: string };

function representationRows(
  entry: CDFComponentEntry,
  plans: RepresentationPlan[],
  selected: RepresentationPlan | undefined,
  view: RepresentationView,
): RepresentationRow[] {
  if (!selected)
    return plans.map((plan) => ({
      id: plan.id,
      label: `${plan.identity.key}: ${plan.kind}${plan.sdkValid ? '' : ' · held'}${entry.$representationPlans?.[plan.identity.key]?.id === plan.id ? ' · selected' : ''}`,
    }));
  switch (view) {
    case 'models':
      return selected.models.map((row) => ({ id: row.originalKey, label: row.key }));
    case 'mappings':
      return selected.mappings.map((mapping) => {
        const path = mapping.path.map((segment) => String(segment.key)).join(' / ');
        const destination =
          (mapping.componentKey ?? mapping.disposition) +
          (mapping.field ? '.' + mapping.field : '') +
          (mapping.targetNodeId ? ' → ' + mapping.targetNodeId : '');
        const intent = [
          mapping.required ? 'required' : 'optional',
          ...(mapping.readonly ? ['readonly'] : []),
          ...(mapping.nullable === null ? ['null unknown'] : mapping.nullable ? ['nullable'] : []),
          ...(mapping.undefinable === null ? ['undefined unknown'] : mapping.undefinable ? ['undefined allowed'] : []),
          ...(mapping.defaultIntent?.action === 'set'
            ? ['source default ' + JSON.stringify(mapping.defaultIntent.value)]
            : []),
        ];
        return { id: mapping.nodeId, label: `${path} → ${destination} · ${intent.join(' · ')}` };
      });
    case 'relationships':
      return selected.models.flatMap((row) =>
        Object.entries(row.entry.$slots ?? {}).map(([name, slot]) => ({
          id: row.originalKey + ':' + name,
          label: `${row.key}.${name} → ${(slot.$allowedComponents ?? []).join(', ')} · ${slot.$cardinality?.min ?? 0}..${slot.$cardinality?.max ?? 'many'}${slot.$cardinality?.ordered ? ' · ordered' : ''}`,
        })),
      );
    case 'requirements':
      return selected.requirements.map((requirement, index) => ({
        id: String(index),
        label: `${requirement.path}: ${requirement.capability} · pending`,
      }));
  }
}

export function RepresentationEditor({
  entry,
  width,
  height,
  choices,
  choose,
  save,
  close,
}: {
  entry: CDFComponentEntry;
  width: number;
  height: number;
  choices?: () => RepresentationPlan[];
  choose?: (property: string, kind: RepresentationPlan['kind'], candidateId?: string) => boolean;
  save: (value?: string) => boolean | void;
  close: () => void;
}): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [property, setProperty] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<RepresentationView>('models');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  let observedError = error;
  let plans: RepresentationPlan[] = [];
  try {
    plans = choices?.() ?? [];
  } catch (issue) {
    observedError ??= issue instanceof Error ? issue.message : 'Source unavailable';
  }
  const selected = property ? entry.$representationPlans?.[property] : undefined;
  const models = selected?.models ?? [];
  const model = models.find((row) => row.key === editing);
  const rows = representationRows(entry, plans, selected, view);
  useImmediateInput((input, key) => {
    if (renaming && selected) {
      if (key.escape) setRenaming(null);
      else if (key.return) {
        try {
          const next = cloneJson(entry);
          next.$representationPlans![property!]!.models.find((row) => row.originalKey === renaming)!.key = nameDraft;
          if (save(JSON.stringify(next, null, 2)) === true) {
            setRenaming(null);
            setError(null);
          } else setError('Model name was not saved');
        } catch (issue) {
          setError(issue instanceof Error ? issue.message : 'Invalid model name');
        }
      } else if (key.backspace || key.delete) setNameDraft((value) => value.slice(0, -1));
      else if (!key.ctrl && [...input].every((character) => character.charCodeAt(0) >= 32))
        setNameDraft((value) => value + input);
      return;
    }
    if (editing) return;
    const length = rows.length;
    if (key.upArrow) setCursor((row) => Math.max(0, row - 1));
    else if (key.downArrow) setCursor((row) => Math.min(Math.max(0, length - 1), row + 1));
    else if (key.escape) {
      if (property) {
        setProperty(null);
        setCursor(0);
      } else close();
    } else if (selected && key.tab) {
      const views = ['models', 'mappings', 'relationships', 'requirements'] as const;
      setView(views[(views.indexOf(view) + 1) % views.length]!);
      setCursor(0);
    } else if (selected && view === 'models' && input === 'r') {
      const target = models[cursor];
      if (target) {
        setRenaming(target.originalKey);
        setNameDraft(target.key);
      }
    } else if (key.return) {
      if (selected && view === 'models') {
        const target = models[cursor];
        if (target) {
          setEditing(target.key);
          setDraft('');
        }
      } else if (!selected) {
        const target = plans[cursor];
        if (target && target.sdkValid && choose?.(target.identity.key, target.kind, target.id) === true) {
          setProperty(target.identity.key);
          setCursor(0);
        }
      }
    }
  });
  if (model && selected)
    return (
      <FieldEditor
        key={model.key + selected.id}
        width={width}
        height={height}
        active
        value={draft || JSON.stringify(model.entry, null, 2)}
        onChange={setDraft}
        onDiscard={() => setDraft('')}
        onExit={() => {
          setEditing(null);
          setDraft('');
        }}
        onSave={(value) => {
          try {
            const next = cloneJson(entry);
            const planned = next.$representationPlans![property!]!;
            planned.models.find((row) => row.key === editing)!.entry = parseStrictJson(
              value ?? draft,
            ) as unknown as CDFComponentEntry;
            const acknowledged = save(JSON.stringify(next, null, 2)) === true;
            if (acknowledged) {
              setDraft('');
              setError(null);
            } else setError('Model edit was not saved');
            return acknowledged;
          } catch (issue) {
            setError(issue instanceof Error ? issue.message : 'Invalid model draft');
            return false;
          }
        }}
        header={<Text bold>{property} · editable model</Text>}
        headerHeight={1}
      />
    );
  return (
    <Box width={width} height={height} flexDirection="column">
      <Text bold>{selected ? `${property} · ${selected.kind}` : 'Source representations'}</Text>
      <Text color={PALETTE.muted}>
        {renaming
          ? 'Enter save name · Esc cancel'
          : selected
            ? '↑/↓ move · Enter edit · r rename · Tab change view · Esc back'
            : '↑/↓ move · Enter choose and save · Esc back'}
      </Text>
      {renaming && <Text color={PALETTE.warning}>Model name: {nameDraft}▏</Text>}
      {selected && (
        <Text>
          {view} · {selected.mappings.length} mapped source nodes · {models.length} models
        </Text>
      )}
      {observedError && <Text color={PALETTE.error}>{observedError}</Text>}
      {selected && (
        <Text color={PALETTE.warning}>
          {selected.requirements.length
            ? 'Desired definition saved; preview prerequisites remain unavailable'
            : 'Native representation saved'}
        </Text>
      )}
      {rows.slice(Math.max(0, cursor - Math.max(1, height - 8)), cursor + Math.max(1, height - 8)).map((row) => (
        <Text key={row.id} color={rows.indexOf(row) === cursor ? PALETTE.warning : undefined}>
          {rows.indexOf(row) === cursor ? '› ' : '  '}
          {row.label}
        </Text>
      ))}
      {selected && !rows.length && <Text>No {view} in this representation</Text>}
      {!plans.length && !selected && <Text>No source-bound editable alternatives available</Text>}
    </Box>
  );
}

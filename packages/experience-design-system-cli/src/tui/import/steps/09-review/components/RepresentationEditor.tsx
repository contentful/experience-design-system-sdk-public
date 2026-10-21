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
import { PALETTE } from '../theme.js';

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
  choose?: (property: string, kind: RepresentationPlan['kind']) => boolean;
  save: (value?: string) => boolean | void;
  close: () => void;
}): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [property, setProperty] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
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
  useImmediateInput((_input, key) => {
    if (editing) return;
    const length = selected ? models.length : plans.length;
    if (key.upArrow) setCursor((row) => Math.max(0, row - 1));
    else if (key.downArrow) setCursor((row) => Math.min(Math.max(0, length - 1), row + 1));
    else if (key.escape) {
      if (property) {
        setProperty(null);
        setCursor(0);
      } else close();
    } else if (key.return) {
      if (selected) {
        const target = models[cursor];
        if (target) {
          setEditing(target.key);
          setDraft('');
        }
      } else {
        const target = plans[cursor];
        if (target && target.sdkValid && choose?.(target.identity.key, target.kind) === true) {
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
      <Text color={PALETTE.muted}>↑/↓ move · Enter {selected ? 'edit model' : 'choose and save'} · Esc back</Text>
      {observedError && <Text color={PALETTE.error}>{observedError}</Text>}
      {selected && (
        <Text color={PALETTE.warning}>
          {selected.requirements.length
            ? 'Desired definition saved; preview prerequisites remain unavailable'
            : 'Native representation saved'}
        </Text>
      )}
      {(selected ? models : plans)
        .slice(Math.max(0, cursor - Math.max(1, height - 5)), cursor + Math.max(1, height - 5))
        .map((row) => {
          const index = (selected ? models : plans).indexOf(row as never);
          const label = 'kind' in row ? `${row.identity.key}: ${row.kind}${row.sdkValid ? '' : ' · held'}` : row.key;
          return (
            <Text key={'id' in row ? row.id : row.key} color={index === cursor ? PALETTE.warning : undefined}>
              {index === cursor ? '› ' : '  '}
              {label}
            </Text>
          );
        })}
      {!plans.length && !selected && <Text>No source-bound editable alternatives available</Text>}
    </Box>
  );
}

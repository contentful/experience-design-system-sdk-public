import React, { useState } from 'react';
import type { StepDone } from '../StepLayout.js';
import { PREFERENCE_OPTIONS, type PreferenceKey } from './index.js';
import { PreferencesMenu } from './PreferencesMenu.js';

/**
 * The preferences step: a menu the operator returns to after each setting they
 * open, rather than a forced walk through all six. The step reports `completed`
 * only if something actually changed, so an operator who just looks and leaves
 * is recorded as having skipped it.
 */
export function PreferencesStep({ onDone }: { onDone: StepDone }): React.ReactElement {
  const [open, setOpen] = useState<PreferenceKey | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<PreferenceKey>>(new Set());

  if (open === null) {
    return <PreferencesMenu changed={changed} onOpen={setOpen} onDone={onDone} />;
  }

  const entry = PREFERENCE_OPTIONS.find((option) => option.key === open);
  if (!entry) return <PreferencesMenu changed={changed} onOpen={setOpen} onDone={onDone} />;

  const { key, Screen } = entry;

  return (
    <Screen
      key={key}
      onDone={(status) => {
        if (status === 'completed') {
          setChanged((current) => new Set(current).add(key));
        }
        setOpen(null);
      }}
    />
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@tui/theme.js';
import { ControlHints } from '@tui/shared/components/ControlHints.js';
import { startDebugRun, finishDebugRun, startDebugSessionIn } from '../../../debug-store.js';
import {
  createTrail,
  describeSettingsFile,
  diffSnapshots,
  scrubError,
  type Snapshot,
} from '../../shared/debug-trail.js';
import { FieldForm, type FormField, type FormNotice } from '@tui/shared/components/FieldForm.js';
import { readCredentials, writeCredentials, type V1Credentials } from './project-store.js';

type Field =
  | 'spaceId'
  | 'environmentId'
  | 'cmaToken'
  | 'host'
  | 'defaultComponentDir'
  | 'defaultTokenFile'
  | 'contentfulBaseDir';

const FIELDS: readonly FormField<Field>[] = [
  { key: 'spaceId', label: 'Space ID' },
  { key: 'environmentId', label: 'Environment ID' },
  { key: 'cmaToken', label: 'CMA Token', masked: true },
  { key: 'host', label: 'API Host' },
  { key: 'defaultComponentDir', label: 'Default component directory' },
  { key: 'defaultTokenFile', label: 'Default token file' },
  { key: 'contentfulBaseDir', label: 'Root Project Directory', hint: '(where .contentful goes)' },
];

function debugFields(config: V1Credentials | null): Record<string, unknown> {
  return {
    space_id: config?.spaceId ?? '',
    environment_id: config?.environmentId ?? '',
    cma_token: config?.cmaToken ?? '',
    host: config?.host ?? '',
    default_component_dir: config?.defaultComponentDir ?? '',
    default_token_file: config?.defaultTokenFile ?? '',
    contentful_base_dir: config?.contentfulBaseDir ?? '',
  };
}

// The fields as flat text, for comparing what the screen opened with against what it closed with.
const snapshotOf = (config: V1Credentials): Snapshot =>
  Object.fromEntries(FIELDS.map(({ key }) => [key, config[key] || '']));

const valuesOf = (config: V1Credentials): Record<Field, string> =>
  Object.fromEntries(FIELDS.map(({ key }) => [key, config[key] || ''])) as Record<Field, string>;

/** The Contentful project settings: the space, credentials, defaults and where `.contentful` goes. */
export function ProjectScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [config, setConfig] = useState<V1Credentials | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // What this visit adds to the debug log: what the user did, the values it opened with, and the last error.
  // `persisted` is what is in the settings file: it starts as the opening values and moves on each successful save.
  const visit = useRef({
    trail: createTrail(),
    before: undefined as Snapshot | undefined,
    persisted: undefined as Snapshot | undefined,
    error: '',
  }).current;

  // The CMA token must not reach a log through an error message, so every error is scrubbed against the current one.
  const scrub = (err: unknown): string => scrubError(err, [config?.cmaToken ?? '']);

  useEffect(() => {
    readCredentials()
      .then((cfg) => {
        setConfig(cfg);
        visit.before = snapshotOf(cfg);
        visit.persisted = visit.before;
        startDebugRun({
          flow: 'settings/contentful-configuration',
          step: '01-configuration',
          menuOption: 'Configuration > Project',
          inputs: { ...debugFields(cfg), settings_file: describeSettingsFile() },
        });
      })
      .catch((err: unknown) => {
        // Start a run anyway: a settings file that cannot be read is what someone would send us a log about.
        visit.error = scrubError(err, []);
        startDebugRun({
          flow: 'settings/contentful-configuration',
          step: '01-configuration',
          menuOption: 'Configuration > Project',
          inputs: { settings_file: describeSettingsFile() },
        });
        setLoadError(visit.error);
      });
  }, []);

  // Finishes the log. `changed` is about the settings file, so an edit that was never saved does not count as a change;
  // it is reported on its own, since "I typed it and nothing happened" is what people write in about.
  const endVisit = (current: V1Credentials | null): void => {
    const onScreen = current ? snapshotOf(current) : undefined;
    const change =
      visit.before && visit.persisted
        ? diffSnapshots(visit.before, visit.persisted)
        : { changed: false, changed_fields: [] };
    const unsaved =
      visit.persisted && onScreen ? diffSnapshots(visit.persisted, onScreen) : { changed: false, changed_fields: [] };
    void finishDebugRun({
      outputs: {
        ...debugFields(current),
        ...change,
        unsaved_edits: unsaved.changed_fields,
        actions: visit.trail.entries(),
        ...(visit.error ? { error: visit.error } : {}),
      },
      status: visit.error ? 'error' : 'success',
      exitMethod: change.changed ? 'saved' : 'discarded',
    });
  };

  // With the settings unreadable there is nothing to show, so the only thing left to do is go back.
  useInput((input, key) => {
    if (!config && loadError && (key.escape || input === 'q')) {
      endVisit(null);
      onDone();
    }
  });

  if (!config) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Settings › Configuration › Project</Text>
        <Text> </Text>
        {loadError ? (
          <>
            <Text color={PALETTE.error}>✗ Could not read the settings: {loadError}</Text>
            <Text> </Text>
            <ControlHints hints={[{ keys: 'Esc/q', label: 'back' }]} />
          </>
        ) : (
          <Text color={PALETTE.accent}>Loading...</Text>
        )}
      </Box>
    );
  }

  const save = (): void => {
    setSaving(true);
    setNotice(null);
    writeCredentials(config)
      .then(() => {
        visit.persisted = snapshotOf(config);
        visit.trail.record('saved');
        // Start the session folder now rather than at the next launch.
        if (config.contentfulBaseDir) void startDebugSessionIn(config.contentfulBaseDir, { replace: true });
        setNotice({ kind: 'success', text: 'Project settings saved' });
      })
      .catch((err: unknown) => {
        visit.error = scrub(err);
        visit.trail.record('save failed');
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
      })
      .finally(() => setSaving(false));
  };

  // Leaves without writing anything. Changes since the last save are dropped, and the log says so.
  const quit = (): void => {
    endVisit(config);
    onDone();
  };

  return (
    <FieldForm
      title="Settings › Configuration › Project"
      subtitle="The Contentful space and where the CLI keeps its files."
      fields={FIELDS}
      values={valuesOf(config)}
      onChange={(key, value) => {
        setConfig({ ...config, [key]: value });
        setNotice(null);
        visit.trail.record(`edited ${key}`);
      }}
      enterAdvances
      onSave={save}
      onQuit={quit}
      notice={notice}
      busy={saving}
    />
  );
}

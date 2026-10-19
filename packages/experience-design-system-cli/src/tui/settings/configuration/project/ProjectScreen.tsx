import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '../../../theme.js';
import { startDebugRun, finishDebugRun, startDebugSessionIn } from '../../../debug-store.js';
import { FieldForm, type FormField, type FormNotice } from '../../shared/FieldForm.js';
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

const valuesOf = (config: V1Credentials): Record<Field, string> =>
  Object.fromEntries(FIELDS.map(({ key }) => [key, config[key] || ''])) as Record<Field, string>;

/** The Contentful project settings: the space, credentials, defaults and where `.contentful` goes. */
export function ProjectScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [config, setConfig] = useState<V1Credentials | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  // The config as last written to disk, so leaving can log whether anything was saved.
  const [lastSaved, setLastSaved] = useState<V1Credentials | null>(null);

  useEffect(() => {
    void readCredentials().then((cfg) => {
      setConfig(cfg);
      startDebugRun({
        flow: 'settings/contentful-configuration',
        step: '01-configuration',
        menuOption: 'Configuration > Project',
        inputs: debugFields(cfg),
      });
    });
  }, []);

  if (!config) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>Project</Text>
        <Text> </Text>
        <Text color={PALETTE.accent}>Loading...</Text>
      </Box>
    );
  }

  const save = (): void => {
    setSaving(true);
    setNotice(null);
    writeCredentials(config)
      .then(() => {
        setLastSaved(config);
        // Start the session folder now rather than at the next launch.
        if (config.contentfulBaseDir) void startDebugSessionIn(config.contentfulBaseDir, { replace: true });
        setNotice({ kind: 'success', text: 'Project settings saved' });
      })
      .catch((err: unknown) => {
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
      })
      .finally(() => setSaving(false));
  };

  // Leaves without writing anything. Changes since the last save are dropped.
  const quit = (): void => {
    void finishDebugRun(
      lastSaved
        ? { outputs: debugFields(lastSaved), status: 'success', exitMethod: 'saved' }
        : { outputs: {}, status: 'success', exitMethod: 'discarded' },
    );
    onDone();
  };

  return (
    <FieldForm
      title="Project"
      subtitle="The Contentful space and where the CLI keeps its files."
      fields={FIELDS}
      values={valuesOf(config)}
      onChange={(key, value) => {
        setConfig({ ...config, [key]: value });
        setNotice(null);
      }}
      onSave={save}
      onQuit={quit}
      notice={notice}
      busy={saving}
    />
  );
}

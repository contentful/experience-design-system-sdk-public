import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { PasswordInput, Select, TextInput } from '@inkjs/ui';
import {
  experiencesCredentialsPath,
  readExperiencesCredentials,
  writeExperiencesCredentials,
  type ExperiencesCredentials,
} from '../../credentials-store.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../../host-utils.js';
import { StepLayout, StepValue, StepWarning, type StepDone } from './StepLayout.js';

const ENV_KEYS = ['CONTENTFUL_SPACE_ID', 'CONTENTFUL_ENVIRONMENT_ID', 'CONTENTFUL_MANAGEMENT_TOKEN', 'EDS_HOST'];

/**
 * Env vars still act as a fallback when a field on disk is empty, so an operator
 * who skips this step should know an ambient value would take effect.
 */
export function envShadowingWarning(env: NodeJS.ProcessEnv): string | null {
  const set = ENV_KEYS.filter((key) => env[key]);
  if (set.length === 0) return null;
  return `Env vars set: ${set.join(', ')}. Values saved here take precedence; env vars only apply where disk is empty.`;
}

export function maskToken(token: string): string {
  return `${'•'.repeat(Math.min(token.length, 8))}...`;
}

const ENTER = 'enter';
const KEEP = 'keep';

type Field = 'spaceId' | 'environmentId' | 'cmaToken' | 'host';

const FIELD_ORDER: Field[] = ['spaceId', 'environmentId', 'cmaToken', 'host'];

export function ContentfulCredentialsScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  const [stored, setStored] = useState<ExperiencesCredentials | null>(null);
  const [field, setField] = useState<Field | 'confirm'>('confirm');
  // Each input's onSubmit closes over the render that created it, so the
  // accumulated answers live in a ref — reading state would only ever see the
  // snapshot from the render that mounted that field.
  const enteredRef = useRef<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readExperiencesCredentials().then(setStored);
  }, []);

  if (!stored) return <Text dimColor>Reading saved credentials…</Text>;

  const currentHost = stored.host ?? DEFAULT_CONFIGURED_HOST;
  const hasAny = Boolean(stored.spaceId || stored.environmentId || stored.cmaToken);
  const allSet = Boolean(stored.spaceId && stored.environmentId && stored.cmaToken);
  const shadowing = envShadowingWarning(process.env);

  const summary = (
    <>
      {shadowing && <StepWarning>{shadowing}</StepWarning>}
      {hasAny && (
        <Box flexDirection="column" marginTop={shadowing ? 1 : 0}>
          <Text>Current values:</Text>
          <StepValue label="Space ID" value={stored.spaceId} />
          <StepValue label="Environment ID" value={stored.environmentId} />
          <StepValue label="CMA Token" value={stored.cmaToken ? maskToken(stored.cmaToken) : undefined} />
          <StepValue label="API Host" value={currentHost} />
        </Box>
      )}
      {error && <StepWarning>{error}</StepWarning>}
    </>
  );

  const helpText = `Saved to ${experiencesCredentialsPath()} — loaded automatically by experiences import.`;

  if (field === 'confirm') {
    // Fully configured credentials default to leaving them alone; an incomplete
    // set defaults to entering them, since that is what the operator came for.
    const options = [
      { label: hasAny ? 'Update the saved credentials' : 'Enter credentials now', value: ENTER },
      { label: allSet ? 'Keep them as they are' : 'Skip for now', value: KEEP },
    ];
    return (
      <StepLayout
        helpText={helpText}
        prompt={
          <Box flexDirection="column">
            <Text>Contentful credentials</Text>
            <Box marginTop={1}>
              <Select
                // Select highlights its first option, so the sensible default
                // leads: keep a complete set, enter an incomplete one.
                options={allSet ? [...options].reverse() : options}
                onChange={(value) => (value === ENTER ? setField('spaceId') : onDone('skipped'))}
              />
            </Box>
          </Box>
        }
      >
        {summary}
      </StepLayout>
    );
  }

  const advance = (from: Field, value: string): void => {
    enteredRef.current = { ...enteredRef.current, [from]: value };
    const index = FIELD_ORDER.indexOf(from);
    if (index < FIELD_ORDER.length - 1) {
      setField(FIELD_ORDER[index + 1]!);
      return;
    }
    void persist(enteredRef.current);
  };

  const persist = async (values: Partial<Record<Field, string>>): Promise<void> => {
    const spaceId = values.spaceId?.trim() || stored.spaceId;
    const environmentId = values.environmentId?.trim() || stored.environmentId || 'master';
    const cmaToken = values.cmaToken?.trim() || stored.cmaToken;
    if (!spaceId || !cmaToken) {
      setError('Space ID and CMA token are required. Skipped.');
      onDone('failed');
      return;
    }
    const host = toConfiguredHost(values.host?.trim() ?? '') ?? stored.host;
    await writeExperiencesCredentials({
      ...stored,
      spaceId,
      environmentId,
      cmaToken,
      ...(host ? { host } : {}),
    });
    onDone('completed');
  };

  const prompts: Record<Field, React.ReactNode> = {
    spaceId: (
      <Box>
        <Text>{`Space ID${stored.spaceId ? ` [${stored.spaceId}]` : ''}: `}</Text>
        <TextInput key="spaceId" onSubmit={(v) => advance('spaceId', v)} />
      </Box>
    ),
    environmentId: (
      <Box>
        <Text>{`Environment ID [${stored.environmentId || 'master'}]: `}</Text>
        <TextInput key="environmentId" onSubmit={(v) => advance('environmentId', v)} />
      </Box>
    ),
    cmaToken: (
      <Box>
        <Text>{`CMA token${stored.cmaToken ? ' [press Enter to keep existing]' : ' (paste here)'}: `}</Text>
        <PasswordInput key="cmaToken" onSubmit={(v) => advance('cmaToken', v)} />
      </Box>
    ),
    host: (
      <Box>
        <Text>{`API host [${currentHost}]: `}</Text>
        <TextInput key="host" onSubmit={(v) => advance('host', v)} />
      </Box>
    ),
  };

  return (
    <StepLayout helpText={helpText} prompt={prompts[field]}>
      {summary}
    </StepLayout>
  );
}

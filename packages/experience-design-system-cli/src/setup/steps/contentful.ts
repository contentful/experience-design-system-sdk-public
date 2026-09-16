import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../../host-utils.js';
import { emit, type SetupActionDependencies, type SetupCheckResult } from '../lib/types.js';

const CURRENT_VALUE_LABEL_WIDTH = 'Environment ID'.length + 2;

function emitCurrentValue(
  dependencies: SetupActionDependencies,
  label: string,
  value: string | undefined | false,
): void {
  const paddedLabel = label.padEnd(CURRENT_VALUE_LABEL_WIDTH);
  if (value) emit(dependencies, 'value', `${paddedLabel}${value}`);
  else emit(dependencies, 'warning', `${paddedLabel}(not set)`);
}

export async function runCredentialsSetup(dependencies: SetupActionDependencies): Promise<SetupCheckResult> {
  emit(
    dependencies,
    'help',
    `Saved to ${dependencies.credentialsPath()} — loaded automatically by experiences import.`,
  );
  emit(dependencies, 'info', '');
  const envShadowing = [
    dependencies.env['CONTENTFUL_SPACE_ID'] ? 'CONTENTFUL_SPACE_ID' : undefined,
    dependencies.env['CONTENTFUL_ENVIRONMENT_ID'] ? 'CONTENTFUL_ENVIRONMENT_ID' : undefined,
    dependencies.env['CONTENTFUL_MANAGEMENT_TOKEN'] ? 'CONTENTFUL_MANAGEMENT_TOKEN' : undefined,
    dependencies.env['EDS_HOST'] ? 'EDS_HOST' : undefined,
  ].filter((value): value is string => value !== undefined);
  if (envShadowing.length > 0) {
    emit(
      dependencies,
      'warning',
      `Env vars set: ${envShadowing.join(', ')}. Values saved here take precedence; env vars only apply where disk is empty.`,
    );
  }

  const stored = await dependencies.readCredentials();
  const currentHost = stored.host ?? DEFAULT_CONFIGURED_HOST;
  const hasAny = Boolean(stored.spaceId || stored.environmentId || stored.cmaToken);
  const allSet = Boolean(stored.spaceId && stored.environmentId && stored.cmaToken);
  if (hasAny) {
    emit(dependencies, 'info', 'Current values:');
    emitCurrentValue(dependencies, 'Space ID', stored.spaceId);
    emitCurrentValue(dependencies, 'Environment ID', stored.environmentId);
    emitCurrentValue(
      dependencies,
      'CMA Token',
      stored.cmaToken && `${'•'.repeat(Math.min(stored.cmaToken.length, 8))}...`,
    );
    emitCurrentValue(dependencies, 'API Host', currentHost);
  }
  if (!(await dependencies.confirm(hasAny ? 'Update credentials?' : 'Configure Contentful credentials?', !allSet))) {
    if (allSet) emit(dependencies, 'success', 'Credentials already configured — no changes made');
    else emit(dependencies, 'warning', 'Skipped. experiences import will prompt for credentials interactively.');
    return { passed: true };
  }
  const spaceId =
    (await dependencies.ask(`Space ID${stored.spaceId ? ` [${stored.spaceId}]` : ''}: `)) || stored.spaceId;
  const environmentId =
    (await dependencies.ask(`Environment ID [${stored.environmentId || 'master'}]: `)) ||
    stored.environmentId ||
    'master';
  const cmaToken =
    (await dependencies.askSecret(
      `CMA token${stored.cmaToken ? ' [press Enter to keep existing]' : ' (paste here)'}: `,
    )) || stored.cmaToken;
  if (!spaceId || !cmaToken) {
    emit(dependencies, 'warning', 'Space ID and CMA token are required. Skipped.');
    return { passed: false };
  }
  const hostInput = await dependencies.ask(`API host [${currentHost}]: `);
  const host = toConfiguredHost(hostInput) ?? stored.host;
  await dependencies.writeCredentials({ ...stored, spaceId, environmentId, cmaToken, ...(host ? { host } : {}) });
  emit(dependencies, 'success', `Credentials saved to ${dependencies.credentialsPath()}`);
  emit(dependencies, 'success', `API host set to ${host ?? DEFAULT_CONFIGURED_HOST}`);
  emit(dependencies, 'info', 'Run experiences import — credentials will be pre-filled automatically.');
  return { passed: true };
}

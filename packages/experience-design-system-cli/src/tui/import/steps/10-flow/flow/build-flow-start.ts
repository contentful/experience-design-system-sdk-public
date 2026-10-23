import { join } from 'node:path';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '@contentful/experience-design-system-backend-pipeline';
import type { ImportHandoff } from '@contentful/experience-design-system-types/handoff';
import type { ExtractionInput } from '../../06-extraction/types.js';
import type { FlowStart } from './controller.js';

interface SavedCredentials {
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  host?: string;
}

/**
 * What the flow starts from. The credentials are the ones the user confirmed. When they skipped validation there are none
 * to use, so the saved ones stand in, which is what the wizard did: it always read them from the store. The review's
 * live preview and the push use them.
 */
export function buildFlowStart(input: {
  extraction: ExtractionInput;
  handoff: ImportHandoff;
  saved?: SavedCredentials;
  generatePromptPath?: string;
  tokensOnly?: FlowStart['tokensOnly'];
}): FlowStart {
  const { extraction, handoff, saved, generatePromptPath, tokensOnly } = input;
  const credentials = extraction.credentials ?? {
    spaceId: saved?.spaceId ?? '',
    environmentId: saved?.environmentId ?? '',
    cmaToken: saved?.cmaToken ?? '',
    host: saved?.host ?? '',
  };
  return {
    handoff,
    agent: extraction.agent,
    projectPath: extraction.projectPath,
    outDir: extraction.projectPath ? join(extraction.projectPath, '.contentful') : '',
    rawTokensPath: extraction.rawTokensPath,
    credentials: {
      spaceId: credentials.spaceId,
      environmentId: credentials.environmentId || 'master',
      cmaToken: credentials.cmaToken,
      host: toConfiguredHost(credentials.host) ?? DEFAULT_CONFIGURED_HOST,
    },
    ...(tokensOnly ? { tokensOnly } : {}),
    ...(generatePromptPath ? { generatePromptPath } : {}),
  };
}

import {
  runImportGeneration,
  type GenerateComponentsProgress,
} from '@contentful/experience-design-system-backend-pipeline';
import { findSkillPath } from '../06-extraction/find-skill-path.js';
import { agentAuthMessage } from '../06-extraction/logic.js';
import type { GenerationInput, GenerationProgress, GenerationResult } from './types.js';

const COMPONENTS_SKILL_PATH = findSkillPath('generate-components.md');
const MAP_TOKENS_SKILL_PATH = findSkillPath('map-tokens.md');

export async function runGeneration(
  input: GenerationInput,
  onProgress: (progress: GenerationProgress) => void,
): Promise<GenerationResult> {
  let progress: GenerationProgress = { components: null, mapTokens: 'idle', mapTokensEligible: null };
  const { hasTokens: _hasTokens, ...request } = input;
  const result = await runImportGeneration(
    {
      ...request,
      componentsSkillPath: COMPONENTS_SKILL_PATH,
      mapTokensSkillPath: MAP_TOKENS_SKILL_PATH,
    },
    (event) => {
      progress =
        event.kind === 'components'
          ? {
              ...progress,
              components: applyProgressEvent(event.event, progress.components, input.decisions.accepted.length),
            }
          : { ...progress, mapTokens: event.state, mapTokensEligible: event.eligible };
      onProgress(progress);
    },
  );
  if (!result.ok && result.authStatus) {
    return { ok: false, step: result.step, message: agentAuthMessage(input.agent, result.authStatus) };
  }
  return result;
}

function applyProgressEvent(
  event: GenerateComponentsProgress,
  previous: GenerationProgress['components'],
  total: number,
): GenerationProgress['components'] {
  const failed = previous?.failed ?? 0;
  if (event.kind === 'component:preflight-failed') {
    return {
      done: previous?.done ?? 0,
      total: event.total || total,
      current: `${event.name}: generation preflight failed${event.attempt < event.maxAttempts ? ', regenerating' : ''}`,
      failed,
    };
  }
  if (event.kind === 'component:started') {
    return { done: previous?.done ?? 0, total: event.total || total, current: event.name, failed };
  }
  if (event.kind === 'component:completed' || event.kind === 'component:failed' || event.kind === 'component:cached') {
    return {
      done: (previous?.done ?? 0) + 1,
      total: event.total || total,
      current: event.name,
      failed: failed + (event.kind === 'component:failed' ? 1 : 0),
    };
  }
  return previous;
}

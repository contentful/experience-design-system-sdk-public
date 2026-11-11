import type { AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { AGENT_LABELS } from '@tui/settings/configuration/agents/agent-store.js';
import { nameLines, nameList } from '../../shared/entity-lists.js';
import { jobData, jobLines } from '../../shared/job-log.js';
import type { RunningLine } from '../../shared/running-step/logic.js';
import type { GenerationDetails, GenerationInput, GenerationResult } from './types.js';

// What the debug log says about the Generation: which agent ran and with what, which components came out, which were
// restored from the cache instead of generated, which failed, what each job did and how long it took, and where it stopped
// if it failed. The Scope gate log has the names of what was accepted and left out.

/** The component lists as Summary lines and as data, or nothing when the run did not get far enough to know. */
function componentLists(details: GenerationDetails | undefined): { lines: string[]; data: Record<string, unknown> } {
  if (!details) return { lines: [], data: {} };
  const generated = nameList(details.generated);
  const fromCache = nameList(details.fromCache);
  const failed = nameList(details.failed);
  const repeated = nameList(details.duplicateNames);
  return {
    lines: [
      ...nameLines('Newly generated', generated),
      ...nameLines('Restored from the cache (not regenerated)', fromCache),
      ...nameLines('Failed to generate', failed),
      ...nameLines('Found more than once (they share one definition)', repeated),
    ],
    data: {
      generated_components: generated,
      from_cache: fromCache,
      failed_components: failed,
      found_more_than_once: repeated,
    },
  };
}

/** The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. */
export function generationLog({
  input,
  result,
  rows,
  details,
}: {
  input: GenerationInput;
  result: GenerationResult;
  /** The rows the screen showed, with how long each one took. */
  rows: readonly RunningLine[];
  /** Which components were generated, restored from the cache or failed. Undefined if the run never got that far. */
  details: GenerationDetails | undefined;
}): { summary: string[]; data: Record<string, unknown>; status: 'success' | 'error' } {
  const settings = {
    agent: input.agent,
    agent_model: input.agentModel ?? '',
    accepted: input.decisions.accepted.length,
    left_out: input.decisions.rejected.length,
    has_tokens: input.hasTokens,
    cache: !input.noCache,
    prompt_overrides: input.promptOverrides.length,
    custom_generate_prompt: Boolean(input.generatePromptPath),
  };
  const summary = [
    `Agent: ${AGENT_LABELS[input.agent as AgentName] ?? input.agent} (${input.agentModel ? `model ${input.agentModel}` : 'default model'})`,
    `To generate: ${settings.accepted} accepted, ${settings.left_out} left out`,
    `Design tokens: ${settings.has_tokens ? 'used' : 'none'}`,
    `Cache: ${settings.cache ? 'on' : 'off'}`,
    `Prompt overrides: ${settings.prompt_overrides}`,
    `Custom generate prompt: ${settings.custom_generate_prompt ? 'yes' : 'no'}`,
  ];
  const named = componentLists(details);

  if (!result.ok) {
    summary.push(`Result: failed at ${result.step}: ${result.message}`, ...named.lines, 'What ran:', ...jobLines(rows));
    return {
      summary,
      data: {
        ...settings,
        result: 'failed',
        failed_step: result.step,
        error: result.message,
        ...named.data,
        jobs: jobData(rows),
      },
      status: 'error',
    };
  }

  const { generation } = result;
  if (generation.route === 'review') {
    summary.push(
      'Result: done',
      `Definitions ready: ${generation.generatedCount} of ${generation.acceptedCount} accepted`,
      `Token mapping: ${generation.mapTokensEligible ? 'ran' : 'not needed'}`,
      `Session: ${generation.sessionId}`,
      ...named.lines,
      'What ran:',
      ...jobLines(rows),
    );
    return {
      summary,
      data: {
        ...settings,
        result: 'done',
        route: generation.route,
        session_id: generation.sessionId,
        generated: generation.generatedCount,
        map_tokens_eligible: generation.mapTokensEligible,
        ...named.data,
        jobs: jobData(rows),
      },
      status: 'success',
    };
  }

  summary.push(`Result: done (${generation.route})`, ...named.lines, 'What ran:', ...jobLines(rows));
  return {
    summary,
    data: { ...settings, result: 'done', route: generation.route, ...named.data, jobs: jobData(rows) },
    status: 'success',
  };
}

import { agentLine } from '../../shared/agent-log.js';
import { jobData, jobLines } from '../../shared/job-log.js';
import type { RunningLine } from '../../shared/running-step/logic.js';
import type { GenerationInput, GenerationResult } from './types.js';

// What the debug log says about the Generation: which agent ran and with what, how many of the accepted components came
// out, what each job did and how long it took, and where it stopped if it failed. The counts are logged, not the lists of
// names; the Scope gate log has the names.

/** The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. */
export function generationLog({
  input,
  result,
  rows,
}: {
  input: GenerationInput;
  result: GenerationResult;
  /** The rows the screen showed, with how long each one took. */
  rows: readonly RunningLine[];
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
    `Agent: ${agentLine(input.agent, input.agentModel)}`,
    `To generate: ${settings.accepted} accepted, ${settings.left_out} left out`,
    `Design tokens: ${settings.has_tokens ? 'used' : 'none'}`,
    `Cache: ${settings.cache ? 'on' : 'off'}`,
    `Prompt overrides: ${settings.prompt_overrides}`,
    `Custom generate prompt: ${settings.custom_generate_prompt ? 'yes' : 'no'}`,
  ];

  if (!result.ok) {
    summary.push(`Result: failed at ${result.step}: ${result.message}`, 'What ran:', ...jobLines(rows));
    return {
      summary,
      data: { ...settings, result: 'failed', failed_step: result.step, error: result.message, jobs: jobData(rows) },
      status: 'error',
    };
  }

  const { generation } = result;
  if (generation.route === 'review') {
    summary.push(
      'Result: done',
      `Generated: ${generation.generatedCount} of ${generation.acceptedCount} accepted`,
      `Token mapping: ${generation.mapTokensEligible ? 'ran' : 'not needed'}`,
      `Session: ${generation.sessionId}`,
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
        jobs: jobData(rows),
      },
      status: 'success',
    };
  }

  summary.push(`Result: done (${generation.route})`, 'What ran:', ...jobLines(rows));
  return {
    summary,
    data: { ...settings, result: 'done', route: generation.route, jobs: jobData(rows) },
    status: 'success',
  };
}

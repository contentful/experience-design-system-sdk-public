import type { AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { AGENT_LABELS } from '@tui/settings/configuration/agents/agent-store.js';
import { scrubError } from '@tui/shared/debug-trail.js';
import { byAiSuggestion, repeatedNames } from '../../shared/component-facts.js';
import { nameLines, nameList } from '../../shared/entity-lists.js';
import { jobData, jobLines } from '../../shared/job-log.js';
import type { RunningLine } from '../../shared/running-step/logic.js';
import type { ScopeComponent } from '../07-scope-gate/types.js';
import type { TokensOnlyInput, TokensOnlyResult } from './run-tokens-only.js';
import type { ExtractionInput, ExtractionResult } from './types.js';

// What the debug log says about the Extraction: which agent ran and with what, what each job did and how long it took, and
// where it stopped if it failed. The credentials are not repeated here, since the Credentials log has them; the token is
// only used to scrub a failure message, because the agent and the API can echo what they were sent.

const agentLine = (agent: string, model: string | undefined): string =>
  `${AGENT_LABELS[agent as AgentName] ?? agent} (${model ? `model ${model}` : 'default model'})`;

/** The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. */
export function extractionLog({
  input,
  result,
  rows,
  components,
}: {
  input: ExtractionInput;
  result: ExtractionResult;
  /** The rows the screen showed, with how long each one took. */
  rows: readonly RunningLine[];
  /** The components the extraction found, as the session has them. Empty when they could not be read. */
  components: readonly ScopeComponent[];
}): { summary: string[]; data: Record<string, unknown>; status: 'success' | 'error' } {
  const lookup = input.credentials !== null;
  const settings = {
    agent: input.agent,
    agent_model: input.agentModel ?? '',
    files_to_scan: input.filePaths.length,
    has_token_file: input.rawTokensPath !== '',
    existing_components_lookup: lookup,
    cache: !input.noCache,
    prompt_overrides: input.promptOverrides.length,
  };
  const summary = [
    `Agent: ${agentLine(input.agent, input.agentModel)}`,
    `Files to scan: ${settings.files_to_scan}`,
    `Token file: ${settings.has_token_file ? 'yes' : 'none'}`,
    `Existing components lookup: ${lookup ? 'on' : 'off (credentials skipped)'}`,
    `Cache: ${settings.cache ? 'on' : 'off'}`,
    `Prompt overrides: ${settings.prompt_overrides}`,
  ];

  if (!result.ok) {
    const error = scrubError(result.message, [input.credentials?.cmaToken ?? '']);
    summary.push(`Result: failed at ${result.step}: ${error}`, 'What ran:', ...jobLines(rows));
    return {
      summary,
      data: { ...settings, result: 'failed', failed_step: result.step, error, jobs: jobData(rows) },
      status: 'error',
    };
  }

  const { extraction } = result;
  const names = components.map((component) => component.name);
  const found = nameList(names);
  const repeated = nameList(repeatedNames(names));
  const suggested = byAiSuggestion(components);
  const aiAccepted = nameList(suggested.accepted);
  const aiRejected = nameList(suggested.rejected);
  const aiNone = nameList(suggested.none);

  summary.push(
    'Result: done',
    `Session: ${extraction.sessionId}`,
    `Tokens generated: ${extraction.tokenCount}`,
    `Existing entities: ${extraction.existingEntitiesStatus}`,
    `Composition: ${extraction.compositionPhase}`,
    ...nameLines(
      'Components found',
      found,
      0,
      found.count === names.length ? undefined : `${names.length} (${found.count} different names)`,
    ),
    ...nameLines('Found more than once (they share one decision)', repeated),
    ...nameLines('The selection agent accepted', aiAccepted),
    ...nameLines('The selection agent rejected', aiRejected),
    ...nameLines('No suggestion from the selection agent', aiNone),
    'What ran:',
    ...jobLines(rows),
  );
  return {
    summary,
    data: {
      ...settings,
      result: 'done',
      session_id: extraction.sessionId,
      token_count: extraction.tokenCount,
      existing_entities_status: extraction.existingEntitiesStatus,
      composition_phase: extraction.compositionPhase,
      components_found: found,
      found_more_than_once: repeated,
      ai_accepted: aiAccepted,
      ai_rejected: aiRejected,
      ai_no_suggestion: aiNone,
      jobs: jobData(rows),
    },
    status: 'success',
  };
}

/** The same for an import that only generates tokens, which has one job and no scan. */
export function tokensOnlyLog({ input, result }: { input: TokensOnlyInput; result: TokensOnlyResult }): {
  summary: string[];
  data: Record<string, unknown>;
  status: 'success' | 'error';
} {
  const settings = {
    agent: input.agent,
    agent_model: input.agentModel ?? '',
    cache: !input.noCache,
    prompt_overrides: input.promptOverrides.length,
  };
  const summary = [
    `Agent: ${agentLine(input.agent, input.agentModel)}`,
    `Cache: ${settings.cache ? 'on' : 'off'}`,
    `Prompt overrides: ${settings.prompt_overrides}`,
  ];

  if (!result.ok) {
    summary.push(`Result: failed at ${result.step}: ${result.message}`);
    return {
      summary,
      data: { ...settings, result: 'failed', failed_step: result.step, error: result.message },
      status: 'error',
    };
  }

  summary.push('Result: done', `Tokens: ${result.tokenCount}`);
  return {
    summary,
    data: { ...settings, result: 'done', token_count: result.tokenCount, token_session_id: result.tokenSessionId },
    status: 'success',
  };
}

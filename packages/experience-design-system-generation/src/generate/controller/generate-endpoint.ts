import type {
  GenerateEndpointRequest,
  GenerateEndpointResponse,
  GeneratePreviewRequest,
  GeneratePreviewResponse,
  StageToolCalls,
} from '../model/endpoint.js';
import { GenerateRequestError } from '../model/errors.js';
import type { AgentRunResult } from '../model/invocation.js';
import type { PromptOptions, Skill } from '../model/prompt.js';
import type {
  ParsedMapTokenPropToolCalls,
  ParsedSelectToolCalls,
  ParsedTokenToolCalls,
  ParsedToolCalls,
} from '../model/protocol.js';
import { describeAgentFailure } from '../services/failure-diagnostics-service.js';
import type { AgentInvoker } from '../services/ports/agent-invoker.js';
import { buildPrompt } from '../services/prompt-service.js';
import {
  parseMapTokenPropToolCallLines,
  parseSelectToolCallLines,
  parseTokenToolCallLines,
  parseToolCallLines,
} from '../services/protocol-parser-service.js';

export interface GeneratePromptService {
  buildPrompt(options: PromptOptions): Promise<string>;
}

export interface GenerateProtocolParser {
  parseComponents(stdout: string): ParsedToolCalls;
  parseTokens(stdout: string): ParsedTokenToolCalls;
  parseSelect(stdout: string): ParsedSelectToolCalls;
  parseMapTokens(stdout: string): ParsedMapTokenPropToolCalls;
}

export interface GenerateEndpointDependencies {
  invoker: AgentInvoker;
  promptService?: GeneratePromptService;
  protocolParser?: GenerateProtocolParser;
  describeFailure?: (run: AgentRunResult) => string;
}

export interface GenerateEndpoint {
  /** Builds the prompt, invokes the agent once, and parses the stage's protocol from its output. */
  execute<Stage extends Skill>(request: GenerateEndpointRequest<Stage>): Promise<GenerateEndpointResponse<Stage>>;
  /** Builds the prompt only, without invoking an agent. */
  preview<Stage extends Skill>(request: GeneratePreviewRequest<Stage>): Promise<GeneratePreviewResponse<Stage>>;
}

interface ParsedStage<Stage extends Skill> {
  calls: Array<StageToolCalls[Stage]>;
  warnings: string[];
}

type StageParsers = { [S in Skill]: (stdout: string) => ParsedStage<S> };

const defaultPromptService: GeneratePromptService = { buildPrompt };
const defaultProtocolParser: GenerateProtocolParser = {
  parseComponents: parseToolCallLines,
  parseTokens: parseTokenToolCallLines,
  parseSelect: parseSelectToolCallLines,
  parseMapTokens: parseMapTokenPropToolCallLines,
};

const STAGES_WITH_OPTIONAL_CALLS: ReadonlySet<Skill> = new Set(['map-tokens']);

export function createGenerateEndpoint(dependencies: GenerateEndpointDependencies): GenerateEndpoint {
  const promptService = dependencies.promptService ?? defaultPromptService;
  const protocolParser = dependencies.protocolParser ?? defaultProtocolParser;
  const getFailure = dependencies.describeFailure ?? describeAgentFailure;
  const stageParsers: StageParsers = {
    components: protocolParser.parseComponents,
    tokens: protocolParser.parseTokens,
    select: protocolParser.parseSelect,
    'map-tokens': protocolParser.parseMapTokens,
  };

  function requireStage<Stage extends Skill>(request: GeneratePreviewRequest<Stage>): Stage {
    const stage = request.prompt.skill;
    if (!Object.hasOwn(stageParsers, stage)) throw new GenerateRequestError('unknown-stage', stage);
    return stage;
  }

  return {
    async execute<Stage extends Skill>(request: GenerateEndpointRequest<Stage>) {
      const stage = requireStage(request);
      const prompt = await promptService.buildPrompt(request.prompt);
      const run = await dependencies.invoker.invoke({ ...request.invocation, prompt });
      const { calls, warnings } = (stageParsers[stage] as (stdout: string) => ParsedStage<Stage>)(run.stdout);
      const failure = getRunFailure(run, stage, calls.length, getFailure);

      return { stage, prompt, run, calls, warnings, ...(failure ? { failure } : {}) };
    },
    async preview<Stage extends Skill>(request: GeneratePreviewRequest<Stage>) {
      const stage = requireStage(request);
      return { stage, prompt: await promptService.buildPrompt(request.prompt) };
    },
  };
}

function getRunFailure(
  run: AgentRunResult,
  stage: Skill,
  callCount: number,
  describeFailure: (run: AgentRunResult) => string,
): string | undefined {
  if (run.timedOut) return 'agent timed out';
  if (run.exitCode !== 0) return describeFailure(run);
  if (callCount === 0 && !STAGES_WITH_OPTIONAL_CALLS.has(stage)) return describeFailure(run);
  return undefined;
}

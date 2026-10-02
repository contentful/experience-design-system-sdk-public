import type { GenerateEndpointRequest, GenerateEndpointResponse } from '../model/endpoint.js';
import type { AgentRunResult } from '../model/invocation.js';
import {
  parseMapTokenPropToolCallLines,
  parseSelectToolCallLines,
  parseTokenToolCallLines,
  parseToolCallLines,
} from '../services/protocol-parser-service.js';
import { describeAgentFailure } from '../services/failure-diagnostics-service.js';
import { buildPrompt } from '../services/prompt-service.js';
import type { PromptOptions } from '../model/prompt.js';
import type { AgentInvoker } from '../services/ports/agent-invoker.js';
import type {
  ParsedMapTokenPropToolCalls,
  ParsedSelectToolCalls,
  ParsedTokenToolCalls,
  ParsedToolCalls,
} from '../model/protocol.js';

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
  execute(request: GenerateEndpointRequest): Promise<GenerateEndpointResponse>;
}

const defaultPromptService: GeneratePromptService = { buildPrompt };
const defaultProtocolParser: GenerateProtocolParser = {
  parseComponents: parseToolCallLines,
  parseTokens: parseTokenToolCallLines,
  parseSelect: parseSelectToolCallLines,
  parseMapTokens: parseMapTokenPropToolCallLines,
};

export function createGenerateEndpoint(dependencies: GenerateEndpointDependencies): GenerateEndpoint {
  const promptService = dependencies.promptService ?? defaultPromptService;
  const protocolParser = dependencies.protocolParser ?? defaultProtocolParser;
  const getFailure = dependencies.describeFailure ?? describeAgentFailure;

  return {
    async execute(request) {
      if (request.stage !== request.prompt.skill) {
        throw new Error(`stage '${request.stage}' does not match prompt skill '${request.prompt.skill}'`);
      }

      const prompt = await promptService.buildPrompt(request.prompt);
      if (request.dryRun) {
        return { stage: request.stage, dryRun: true, prompt };
      }

      const run = await dependencies.invoker.invoke({ ...request.invocation, prompt });
      const parsed = parseStageOutput(request, protocolParser, run.stdout);
      const failure = getRunFailure(run, parsed.calls.length, getFailure);

      return {
        stage: request.stage,
        dryRun: false,
        prompt,
        run,
        calls: parsed.calls,
        warnings: parsed.warnings,
        ...(failure ? { failure } : {}),
      } as GenerateEndpointResponse;
    },
  };
}

function getRunFailure(run: AgentRunResult, callCount: number, describeFailure: (run: AgentRunResult) => string) {
  if (run.timedOut) return 'agent timed out';
  if (run.exitCode !== 0 || callCount === 0) return describeFailure(run);
  return undefined;
}

function parseStageOutput(
  request: GenerateEndpointRequest,
  parser: GenerateProtocolParser,
  stdout: string,
): ParsedToolCalls | ParsedTokenToolCalls | ParsedSelectToolCalls | ParsedMapTokenPropToolCalls {
  switch (request.stage) {
    case 'components':
      return parser.parseComponents(stdout);
    case 'tokens':
      return parser.parseTokens(stdout);
    case 'select':
      return parser.parseSelect(stdout);
    case 'map-tokens':
      return parser.parseMapTokens(stdout);
  }
}

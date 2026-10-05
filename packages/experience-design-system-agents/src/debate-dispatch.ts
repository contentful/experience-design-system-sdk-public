import type {
  AgentInvoker,
  AgentName,
  DebateRole,
  PromptOptions,
} from '@contentful/experience-design-system-generation';
import { buildPrompt } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import type { DebateTranscript } from './selection-pipeline.js';
import { invokeOnce } from './invoke-agent.js';
import type { TieredSelectionDisagreement } from './selection-diff.js';

interface DebateEvidence {
  source: string;
  line: string;
  quote: string;
}

interface DebateArgument {
  role: DebateRole;
  disagreementId: string;
  argument: string;
  evidence: DebateEvidence[];
}

export interface SelectionDebateDispatcherOptions {
  invoker: AgentInvoker;
  agent: AgentName;
  model?: string;
  timeoutMs: number;
  outDir: string;
  buildPrompt?: (options: PromptOptions) => Promise<string>;
}

export type SelectionDebateDispatcher = (
  disagreement: TieredSelectionDisagreement,
  component: RawComponentDefinition,
) => Promise<DebateTranscript>;

function parseDebateArgument(stdout: string, role: DebateRole, disagreementId: string): DebateArgument {
  const line = stdout
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith('{'));
  if (!line) throw new Error('Debate ' + role + ' participant returned no JSON argument');

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error('Debate ' + role + ' participant returned invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Debate ' + role + ' participant returned no object');
  }

  const record = parsed as Record<string, unknown>;
  if (record.role !== role || record.disagreement_id !== disagreementId || typeof record.argument !== 'string') {
    throw new Error('Debate ' + role + ' participant returned an argument for the wrong role or disagreement');
  }

  if (!Array.isArray(record.evidence)) {
    throw new Error('Debate ' + role + ' participant returned invalid evidence');
  }

  const evidence = record.evidence.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('Debate ' + role + ' participant returned invalid evidence');
    }
    const citation = item as Record<string, unknown>;
    if (
      typeof citation.source !== 'string' ||
      typeof citation.line !== 'string' ||
      typeof citation.quote !== 'string'
    ) {
      throw new Error('Debate ' + role + ' participant returned invalid evidence');
    }
    return { source: citation.source, line: citation.line, quote: citation.quote };
  });

  return { role, disagreementId, argument: record.argument, evidence };
}

async function invokeDebateRole(
  options: SelectionDebateDispatcherOptions,
  promptBuilder: (options: PromptOptions) => Promise<string>,
  role: DebateRole,
  disagreement: TieredSelectionDisagreement,
  component: RawComponentDefinition,
): Promise<DebateArgument> {
  const prompt = await promptBuilder({
    skill: 'debate-select',
    mode: 'autonomous',
    debateRole: role,
    disagreementInline: JSON.stringify(disagreement),
    outDir: options.outDir,
    componentName: component.name,
    rawComponentsInline: JSON.stringify([component]),
  });
  const result = await invokeOnce(options, prompt, 'Debate ' + role + ' participant failed');
  return parseDebateArgument(result.stdout, role, disagreement.id);
}

export function createSelectionDebateDispatcher(options: SelectionDebateDispatcherOptions): SelectionDebateDispatcher {
  const promptBuilder = options.buildPrompt ?? buildPrompt;
  return async (disagreement, component) => {
    const [forArgument, againstArgument] = await Promise.all([
      invokeDebateRole(options, promptBuilder, 'for', disagreement, component),
      invokeDebateRole(options, promptBuilder, 'against', disagreement, component),
    ]);
    return {
      disagreementId: disagreement.id,
      for: forArgument,
      against: againstArgument,
    };
  };
}

export { parseDebateArgument };

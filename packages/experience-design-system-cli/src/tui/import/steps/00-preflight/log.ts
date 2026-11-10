import { AGENT_NAMES, analyticsEnabled, type AgentName } from '@contentful/experience-design-system-backend-pipeline';
import { readSettings } from '@contentful/experience-design-system-types/config';
import { agentReadiness, type AgentReadiness } from '@tui/settings/configuration/agents/agent-debug.js';
import { LIST_STATUS } from '@tui/settings/configuration/agents/agent-status.js';
import { AGENT_LABELS, readAgentConfig } from '@tui/settings/configuration/agents/agent-store.js';
import { IMPORT_TARGET_OPTIONS, type ImportTarget } from './logic.js';

// What the debug log says about the Preflight: what the user chose, and what was true on their machine when they chose
// it, so a later problem can be read against the terminal, settings and agents they had. The options shown, the order the
// user looked at them in and the steps that follow are left out: the choice already says which steps run.

export type PreflightContext = {
  settings: { default_agent: AgentName; base_dir_set: boolean; analytics: boolean };
  agents: Record<AgentName, AgentReadiness>;
};

/**
 * The settings in effect and each agent's state. Collected while the user reads the screen, because the agent checks run
 * a command each. Undefined when they cannot be read: logging must never get in the way of the import.
 */
export async function collectPreflightContext(): Promise<PreflightContext | undefined> {
  try {
    const [config, settings] = await Promise.all([readAgentConfig(), readSettings()]);
    const baseDir = settings['contentfulBaseDir'];
    return {
      settings: {
        default_agent: config.defaultAgent,
        base_dir_set: typeof baseDir === 'string' && baseDir !== '',
        analytics: analyticsEnabled(),
      },
      agents: await agentReadiness(config),
    };
  } catch {
    return undefined;
  }
}

export type TerminalSize = { columns?: number; rows?: number };

/** The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. */
export function preflightLog(
  chosen: ImportTarget | null,
  terminal: TerminalSize,
  context: PreflightContext | undefined,
): { summary: string[]; data: Record<string, unknown> } {
  const { columns, rows } = terminal;
  const label = IMPORT_TARGET_OPTIONS.find((option) => option.target === chosen)?.label;

  const summary = [
    label ? `Chose: ${label}` : 'Left the import without choosing',
    columns && rows ? `Terminal: ${columns} × ${rows}` : 'Terminal: size unknown',
  ];
  if (context) {
    const { settings, agents } = context;
    summary.push(
      'Settings:',
      `  Default agent: ${AGENT_LABELS[settings.default_agent]}`,
      `  Base directory: ${settings.base_dir_set ? 'set' : 'not set'}`,
      `  Analytics: ${settings.analytics ? 'on' : 'off'}`,
      'Agents:',
      ...AGENT_NAMES.map((name) => `  ${agentLine(name, agents[name])}`),
    );
  } else {
    summary.push('Settings and agents: not collected');
  }

  return {
    summary,
    data: {
      chosen,
      terminal: { columns: columns ?? null, rows: rows ?? null },
      ...(context ? { settings: context.settings, agents: context.agents } : {}),
    },
  };
}

function agentLine(name: AgentName, { status, version }: AgentReadiness): string {
  const number = /\d+(?:\.\d+)+/.exec(version)?.[0];
  return `${AGENT_LABELS[name]}: ${LIST_STATUS[status].text}${number ? ` (${number})` : ''}`;
}

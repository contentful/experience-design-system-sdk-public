import { readExperiencesCredentials } from '../../../persistence/src/credentials/services/read-credentials.js';
import { AGENT_DEFS, INSTALLABLE_AGENTS } from '../constants/agent-defs.js';
import { binaryExists } from '../helpers/binary-exists.js';
import { installCommand } from '../helpers/install-command.js';
import type { CheckOutcome, ReportLine } from '../types/report.js';

export async function reportAgent(): Promise<CheckOutcome> {
  const lines: ReportLine[] = [{ kind: 'section', text: 'Checking coding agent' }];
  const creds = await readExperiencesCredentials();
  const savedAgent = creds.agent;
  const savedModel = creds.agentModel;

  if (savedAgent) {
    if (await binaryExists(savedAgent)) {
      const modelStr = savedModel ? ` — model: ${savedModel}` : '';
      lines.push({ kind: 'ok', text: `${savedAgent}${modelStr} (saved preference)` });
      return { name: 'coding agent', ok: true, required: false, lines };
    }
    lines.push({ kind: 'warn', text: `Saved agent '${savedAgent}' not found on PATH` });
    lines.push({ kind: 'info', text: 'Re-run experiences setup to reconfigure.' });
    return { name: 'coding agent', ok: false, required: false, lines };
  }

  for (const agent of AGENT_DEFS) {
    if (await binaryExists(agent.binary)) {
      lines.push({ kind: 'ok', text: `${agent.name} (${agent.binary}) found` });
      lines.push({ kind: 'info', text: 'Tip: run experiences setup to save a default agent and model.' });
      return { name: 'coding agent', ok: true, required: false, lines };
    }
  }

  lines.push({ kind: 'warn', text: 'No coding agent found on PATH' });
  lines.push({ kind: 'info', text: 'The coding agent is required for the generate steps in experiences import.' });
  lines.push({ kind: 'info', text: 'Install one of:' });
  const labelWidth = Math.max(...INSTALLABLE_AGENTS.map((agent) => agent.name.length + 1)) + 2;
  for (const agent of INSTALLABLE_AGENTS) {
    lines.push({ kind: 'info', text: `  • ${`${agent.name}:`.padEnd(labelWidth)}${installCommand(agent)}` });
  }
  return { name: 'coding agent', ok: false, required: false, lines };
}

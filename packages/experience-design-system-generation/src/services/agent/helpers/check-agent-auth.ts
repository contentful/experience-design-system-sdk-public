import { spawn } from 'node:child_process';
import type { AgentName } from '../../../agent-names.js';
import type { AgentAuthStatus } from '../../../types/agent.js';
import { resolveAgentBinary } from './resolve-agent-binary.js';
import { checkClaudeAuth } from './check-claude-auth.js';

export async function checkAgentAuth(agent: AgentName): Promise<AgentAuthStatus> {
  const binary = resolveAgentBinary(agent);

  const binaryExists = await new Promise<boolean>((resolve) => {
    if (binary.startsWith('/')) {
      import('node:fs/promises').then((fs) =>
        fs.access(binary).then(
          () => resolve(true),
          () => resolve(false),
        ),
      );
      return;
    }
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [binary], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
  });
  if (!binaryExists) return 'not-found';

  if (agent !== 'claude') return 'ok';

  return checkClaudeAuth(binary);
}

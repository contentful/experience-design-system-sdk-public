import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PreparedStagePrompt } from '../../../../agents/helpers/run-stage-with-retries.js';
import type { ExplorationValidationEvidence } from './validate-exploration-draft.js';
import { shellArgument } from '../../../../helpers/shell-argument.js';

export async function prepareExplorationValidator(
  prompt: string | PreparedStagePrompt,
  evidence: ExplorationValidationEvidence,
  signal?: AbortSignal,
): Promise<PreparedStagePrompt> {
  const original = typeof prompt === 'string' ? prompt : prompt.text;
  let directory: string | undefined;
  const dispose = async () => {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      if (typeof prompt !== 'string') await prompt.dispose();
    }
  };
  try {
    signal?.throwIfAborted();
    const sibling = new URL('./validate-exploration-draft.js', import.meta.url);
    const entrypoint = fileURLToPath(
      existsSync(sibling)
        ? sibling
        : new URL(
            './steps/exploration/src/services/validate-exploration-draft.js',
            import.meta.resolve('@contentful/experience-design-system-backend-pipeline'),
          ),
    );
    await access(entrypoint);
    directory = await mkdtemp(join(tmpdir(), 'experiences-exploration-validator-'));
    const evidencePath = join(directory, 'evidence.json');
    const contextPath = join(directory, 'context.md');
    await writeFile(evidencePath, JSON.stringify(evidence), { encoding: 'utf8', mode: 0o400, signal });
    await writeFile(contextPath, original, { encoding: 'utf8', mode: 0o400, signal });
    signal?.throwIfAborted();
    const command = [process.execPath, entrypoint, evidencePath].map(shellArgument).join(' ');
    const instructions = [
      '## Canonical exploration draft validation',
      `Complete immutable original task and source context: ${JSON.stringify(contextPath)}.`,
      'This artifact stays available throughout this scope and its repair attempts. Read targeted sections as needed; source paths are citation labels, not permission to access the live repository.',
      'Before final output, run this exact command with the EXACT complete exploration response you intend to return on stdin:',
      command,
      'Use inline stdin such as a quoted here-document. Read-only shell access to this validator and the supplied artifacts is explicitly allowed even when repository tools are forbidden. Do not modify artifacts or read/execute live project source.',
      'Inspect its diagnostics, repair the draft in this same conversation and validate again until valid is true, within the remaining invocation time. Preserve the complete assigned work inventory, exact component/source/property/slot identities and evidence bindings. Component reports must still include explicit exclusion entries and assigned slot rulings. Do not drop inputs, invent evidence, narrow source domains or change authorability merely to pass validation.',
      'Return the exact validated response in the original output protocol, without command logs or additional commentary. The host independently validates the returned response. If tools or evidence are unavailable, report the concrete blocker instead of claiming success.',
    ].join('\n');
    return { text: `${instructions}\n\n${original}`, repairInstructions: instructions, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

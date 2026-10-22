import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RepresentationValidationEvidence } from './validate-representation-draft.js';

export interface GenerationRepresentationValidator {
  instructions: string;
  dispose: () => Promise<void>;
}

const shellArgument = (value: string): string => "'" + value.replace(/'/g, "'\"'\"'") + "'";

export async function createGenerationRepresentationValidator(
  evidence: RepresentationValidationEvidence,
  signal?: AbortSignal,
): Promise<GenerationRepresentationValidator> {
  signal?.throwIfAborted();
  const sibling = new URL('./validate-representation-draft.js', import.meta.url);
  const entrypoint = fileURLToPath(
    existsSync(sibling)
      ? sibling
      : new URL(
          './steps/generation/src/services/property/validate-representation-draft.js',
          import.meta.resolve('@contentful/experience-design-system-backend-pipeline'),
        ),
  );
  await access(entrypoint);
  const directory = await mkdtemp(join(tmpdir(), 'experiences-representation-validator-'));
  const evidencePath = join(directory, 'evidence.json');
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    await writeFile(evidencePath, JSON.stringify(evidence), { encoding: 'utf8', mode: 0o400, signal });
    signal?.throwIfAborted();
    const command = [process.execPath, entrypoint, evidencePath].map(shellArgument).join(' ');
    return {
      dispose,
      instructions: [
        '## Supplied read-only representation validator',
        'You may run this exact command using read-only shell tools and pass your current draft JSON tool-call lines on stdin:',
        command,
        'The command reads only the supplied immutable evidence file, uses the host materializer and returns per-property validation, missing subjects, alternatives and capability requirements. You may also read that evidence file; embedded source paths remain citation labels.',
        'Use inline stdin (for example a quoted here-document); do not create a draft file, modify evidence or read or execute the live repository/source. Tool availability depends on the selected local agent. Host validation always runs independently and is authoritative.',
        'Review feedback before final output and repair until complete and representationsComplete are both true. Every retained property requires cdf_type. Preserve semantic decisions, source identity, successful representations and accepted exclusions/slot ownership; repair pending representations only. Unresolved compatibility requires a concrete reason and keeps the component incomplete.',
      ].join('\n'),
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

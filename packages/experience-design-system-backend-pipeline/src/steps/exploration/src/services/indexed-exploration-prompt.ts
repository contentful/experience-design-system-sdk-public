import { buildPrompt } from '../../../../agents/index.js';
import type { PromptOptions } from '../../../../agents/types/prompts.js';
import type { PreparedStagePrompt } from '../../../../agents/helpers/run-stage-with-retries.js';
import { prepareExplorationEvidence } from '../../../../source-evidence/indexed-evidence/artifact.js';
import { prepareExplorationValidator } from './exploration-validator-artifact.js';
import type { ExplorationValidationEvidence } from './validate-exploration-draft.js';

/** A work unit retains exact evidence and reader access through every conversation repair. */
export async function prepareIndexedExplorationPrompt(
  options: PromptOptions,
  input: Record<string, unknown>,
  validation: ExplorationValidationEvidence,
): Promise<PreparedStagePrompt> {
  const evidence = await prepareExplorationEvidence(
    {
      input: {
        ...input,
        sharedSource: options.sharedSource,
        sourceRefs: input.sourceRefs ?? options.componentSourceRefs,
        explorationJudgments: options.explorationJudgmentsInline,
        existingComponents: options.existingComponentsInline,
        existingTokens: options.existingTokensInline,
      },
    },
    options.signal,
  );
  try {
    const prompt = await buildPrompt({
      ...options,
      sharedSource: undefined,
      componentSourceRefs: undefined,
      explorationJudgmentsInline: undefined,
      existingComponentsInline: undefined,
      existingTokensInline: undefined,
      stageInputInline: JSON.stringify({ ...evidence.index, evidenceDigest: evidence.digest }),
    });
    const prepared = await prepareExplorationValidator(prompt, validation, options.signal, evidence.instructions);
    return {
      ...prepared,
      dispose: async () => {
        try {
          await prepared.dispose();
        } finally {
          await evidence.dispose();
        }
      },
    };
  } catch (error) {
    await evidence.dispose();
    throw error;
  }
}

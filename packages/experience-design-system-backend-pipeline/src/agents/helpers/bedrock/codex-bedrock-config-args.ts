import { DEFAULT_CODEX_BEDROCK_REGION } from '../../constants/bedrock.js';

/**
 * codex has no Bedrock env var; it requires `-c` config overrides
 * (`model_provider` + the Bedrock provider's region) passed as argv. Region
 * comes from the environment's own AWS region var, falling back to us-east-1
 * — the region gpt-5.6-luna's Bedrock endpoint requires.
 */
export function codexBedrockConfigArgs(): string[] {
  const region =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || DEFAULT_CODEX_BEDROCK_REGION;
  return ['-c', 'model_provider=amazon-bedrock', '-c', `model_providers.amazon-bedrock.region=${region}`];
}

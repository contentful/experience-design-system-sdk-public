/**
 * opencode selects providers via a `provider/model` string rather than a flag
 * or env var, so routing it through Bedrock means rewriting the model string
 * itself. Left alone if it already carries a provider prefix.
 */
export function withBedrockProviderPrefix(model: string): string {
  return model.includes('/') ? model : `amazon-bedrock/${model}`;
}

export type CompositionOptionInput = {
  prompt?: string[];
};

export type CompositionForwardingOptions = {
  promptOverrides?: string[];
};

export function buildCompositionForwardingOptions(options: CompositionOptionInput): CompositionForwardingOptions {
  return {
    ...(options.prompt && options.prompt.length > 0 ? { promptOverrides: options.prompt } : {}),
  };
}

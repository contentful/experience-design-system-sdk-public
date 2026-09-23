export type CompositionOptionInput = {
  compositionMap?: string;
  prompt?: string[];
};

export type CompositionForwardingOptions = {
  compositionMap?: string;
  promptOverrides?: string[];
};

export function buildCompositionForwardingOptions(options: CompositionOptionInput): CompositionForwardingOptions {
  return {
    ...(options.compositionMap ? { compositionMap: options.compositionMap } : {}),
    ...(options.prompt && options.prompt.length > 0 ? { promptOverrides: options.prompt } : {}),
  };
}

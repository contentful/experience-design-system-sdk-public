export type CompositionOptionInput = {
  compositionMap?: string;
  generateMap?: string;
  prompt?: string[];
};

export type CompositionForwardingOptions = {
  compositionMap?: string;
  generateMap?: string;
  promptOverrides?: string[];
};

export function buildCompositionForwardingOptions(options: CompositionOptionInput): CompositionForwardingOptions {
  return {
    ...(options.compositionMap ? { compositionMap: options.compositionMap } : {}),
    ...(options.generateMap ? { generateMap: options.generateMap } : {}),
    ...(options.prompt && options.prompt.length > 0 ? { promptOverrides: options.prompt } : {}),
  };
}

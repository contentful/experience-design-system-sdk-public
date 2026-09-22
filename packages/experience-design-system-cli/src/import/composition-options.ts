export type CompositionOptionInput = {
  generateMap?: string;
  prompt?: string[];
};

export type CompositionForwardingOptions = {
  generateMap?: string;
  promptOverrides?: string[];
};

export function buildCompositionForwardingOptions(options: CompositionOptionInput): CompositionForwardingOptions {
  return {
    ...(options.generateMap ? { generateMap: options.generateMap } : {}),
    ...(options.prompt && options.prompt.length > 0 ? { promptOverrides: options.prompt } : {}),
  };
}

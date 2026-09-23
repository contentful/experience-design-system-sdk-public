export type CompositionOptionInput = {
  compositionMap?: string;
  compositionAgent?: boolean;
  compositionRefresh?: boolean;
  generateMap?: string;
  prompt?: string[];
};

export type CompositionForwardingOptions = {
  compositionMap?: string;
  compositionAgent?: boolean;
  compositionRefresh?: boolean;
  generateMap?: string;
  promptOverrides?: string[];
};

export function buildCompositionForwardingOptions(options: CompositionOptionInput): CompositionForwardingOptions {
  return {
    ...(options.compositionMap ? { compositionMap: options.compositionMap } : {}),
    ...(options.compositionAgent ? { compositionAgent: true } : {}),
    ...(options.compositionRefresh ? { compositionRefresh: true } : {}),
    ...(options.generateMap ? { generateMap: options.generateMap } : {}),
    ...(options.prompt && options.prompt.length > 0 ? { promptOverrides: options.prompt } : {}),
  };
}

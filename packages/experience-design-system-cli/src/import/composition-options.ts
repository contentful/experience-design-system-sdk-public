export type CompositionOptionInput = {
  compositionMap?: string;
  compositionAgent?: boolean;
  compositionAgentMode?: string;
  generateMap?: string;
  prompt?: string[];
};

export type CompositionForwardingOptions = {
  compositionMap?: string;
  compositionAgent?: boolean;
  compositionAgentMode?: string;
  generateMap?: string;
  promptOverrides?: string[];
};

export function buildCompositionForwardingOptions(options: CompositionOptionInput): CompositionForwardingOptions {
  return {
    ...(options.compositionMap ? { compositionMap: options.compositionMap } : {}),
    ...(options.compositionAgent ? { compositionAgent: true } : {}),
    ...(options.compositionAgentMode ? { compositionAgentMode: options.compositionAgentMode } : {}),
    ...(options.generateMap ? { generateMap: options.generateMap } : {}),
    ...(options.prompt && options.prompt.length > 0 ? { promptOverrides: options.prompt } : {}),
  };
}

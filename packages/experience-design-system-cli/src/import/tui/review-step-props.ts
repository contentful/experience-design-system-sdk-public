export type ReviewStepProps = {
  extractSessionId: string;
  tokenSessionId?: string | null;
  onFinalize: (accepted: number, rejected: number, unresolved: number) => void;
  onQuit: () => void;
  livePreview?: boolean;
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  host?: string;
  tokensPath?: string;
  initialFinalizeError?: string | null;
};

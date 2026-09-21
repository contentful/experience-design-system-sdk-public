type WizardSeedInput = {
  generateSessionId: string | null;
  tokenSessionId?: string | null;
  tokensPath?: string | null;
  initialSpaceId?: string;
  initialEnvironmentId?: string;
  initialHost?: string;
  initialCmaToken?: string;
};

type WizardSeedProps = {
  seedGenerateSessionId?: string;
  seedTokenSessionId?: string;
  seedTokensPath?: string;
  initialSpaceId?: string;
  initialEnvironmentId?: string;
  initialHost?: string;
  initialCmaToken?: string;
};

export function applyWizardSeedProps<T extends WizardSeedProps>(props: T, input: WizardSeedInput): void {
  if (input.generateSessionId) props.seedGenerateSessionId = input.generateSessionId;
  if (input.tokenSessionId) props.seedTokenSessionId = input.tokenSessionId;
  if (input.tokensPath) props.seedTokensPath = input.tokensPath;
  if (input.initialSpaceId) props.initialSpaceId = input.initialSpaceId;
  if (input.initialEnvironmentId) props.initialEnvironmentId = input.initialEnvironmentId;
  if (input.initialHost) props.initialHost = input.initialHost;
  if (input.initialCmaToken) props.initialCmaToken = input.initialCmaToken;
}

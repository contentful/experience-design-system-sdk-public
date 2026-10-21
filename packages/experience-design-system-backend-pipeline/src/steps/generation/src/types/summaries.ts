export interface SelectAgentSummary {
  components: Array<{ id: string; name: string; description: string }>;
  tokens: { count: number; kinds: string[] };
}

export interface GenerateAgentSummary {
  likelyMatch?: {
    id: string;
    name: string;
    designProperties: Array<{ id: string; name: string; type: string; definition: unknown }>;
    contentProperties: Array<{ id: string; name: string; type: string; definition: unknown }>;
    propertyEvidence: 'existing-platform-definition-unverified-against-source';
    slots: Array<{ id: string; name: string }>;
  };
  otherComponents: Array<{ id: string; name: string }>;
  tokens: { count: number; kinds: string[] };
}

export interface MapTokensSummary {
  tokens: Array<{ id: string; name: string; type: string }>;
}

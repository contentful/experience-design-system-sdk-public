export interface LlmClient {
  invoke(prompt: string, maxTokens?: number): Promise<string>;
  /** Returns cumulative token usage for all invoke() calls made on this client instance. */
  getTotalUsage?(): { inputTokens: number; outputTokens: number };
}

let _client: LlmClient | null = null;

export function setClient(client: LlmClient): void {
  _client = client;
}

export function getClient(): LlmClient {
  if (!_client) throw new Error('LLM client not initialized — call setClient() before running the eval.');
  return _client;
}

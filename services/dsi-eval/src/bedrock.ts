import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-opus-4-7';
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

const client = new BedrockRuntimeClient({ region: AWS_REGION });

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('too many requests') || msg.includes('throttling') || msg.includes('rate');
}

export async function invokeBedrock(prompt: string, maxTokens = 8096): Promise<string> {
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.send(command);
      const raw = JSON.parse(new TextDecoder().decode(response.body)) as {
        content: Array<{ type: string; text?: string }>;
      };
      return raw.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err)) throw err;
      const delay = BASE_DELAY_MS * 2 ** attempt;
      console.warn(`  [bedrock] rate limited — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastErr;
}

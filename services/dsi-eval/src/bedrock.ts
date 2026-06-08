import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

const client = new BedrockRuntimeClient({ region: AWS_REGION });

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

  const response = await client.send(command);
  const raw = JSON.parse(new TextDecoder().decode(response.body)) as {
    content: Array<{ type: string; text?: string }>;
  };

  return raw.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

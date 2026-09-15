import { describe, expect, it } from 'vitest';
import { promptBedrockPreference } from '../../src/setup/bedrock-prompt.js';

function scripted(answers: string[]): (question: string) => Promise<string> {
  let index = 0;
  return async () => answers[index++] ?? '';
}

describe('promptBedrockPreference', () => {
  it('defaults to disabled when no saved preference exists', async () => {
    await expect(promptBedrockPreference(scripted(['']), undefined)).resolves.toBe(false);
  });

  it('enables Bedrock when the operator answers yes', async () => {
    await expect(promptBedrockPreference(scripted(['y']), false)).resolves.toBe(true);
  });

  it('disables Bedrock when the operator answers no', async () => {
    await expect(promptBedrockPreference(scripted(['n']), true)).resolves.toBe(false);
  });

  it('preserves the saved preference when the operator presses Enter', async () => {
    await expect(promptBedrockPreference(scripted(['']), true)).resolves.toBe(true);
  });

  it('tells the operator that AWS configuration is required', async () => {
    let question = '';
    await promptBedrockPreference(async (value) => {
      question = value;
      return '';
    });

    expect(question).toContain('AWS_PROFILE');
    expect(question).toContain('AWS_REGION');
  });
});

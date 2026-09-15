/**
 * Ask whether the selected coding agent should route requests through AWS
 * Bedrock. AWS credentials and region configuration remain the operator's
 * responsibility and are not stored by the setup wizard.
 */
export async function promptBedrockPreference(
  ask: (question: string) => Promise<string>,
  current?: boolean,
): Promise<boolean> {
  const defaultValue = current ?? false;
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = (
    await ask(
      `  Route the coding agent through AWS Bedrock? ${hint} (requires AWS_PROFILE or AWS credentials and AWS_REGION) `,
    )
  )
    .trim()
    .toLowerCase();
  if (answer === '') return defaultValue;
  if (answer.startsWith('y')) return true;
  if (answer.startsWith('n')) return false;
  return defaultValue;
}

export async function promptBooleanPreference(
  ask: (question: string) => Promise<string>,
  current: boolean | undefined,
  defaultValue: boolean,
  question: string,
): Promise<boolean> {
  const value = current ?? defaultValue;
  const hint = value ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`  ${question} ${hint} `)).trim().toLowerCase();
  if (answer === '') return value;
  if (answer.startsWith('y')) return true;
  if (answer.startsWith('n')) return false;
  return value;
}

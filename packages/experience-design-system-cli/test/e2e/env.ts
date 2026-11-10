/** Sets environment variables for a scenario and returns what puts each one back as it was. */
export function setEnv(values: Record<string, string>): () => void {
  const previous = Object.keys(values).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, values);
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

const DOWN = String.fromCharCode(27) + '[B';
const ENTER = String.fromCharCode(13);

const settle = (ms = 60): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drive an `@inkjs/ui` Select by walking to the row whose label matches, then
 * submitting. The highlight starts on the option the screen defaults to, so
 * tests move relative to whatever is currently marked with the pointer.
 */
export async function choose(
  stdin: { write: (data: string) => void },
  getFrame: () => string | undefined,
  label: string,
  maxSteps = 6,
): Promise<void> {
  for (let step = 0; step < maxSteps; step++) {
    const frame = getFrame() ?? '';
    const pointed = frame.split('\n').find((line) => line.includes('❯'));
    if (pointed?.includes(label)) {
      stdin.write(ENTER);
      await settle();
      return;
    }
    stdin.write(DOWN);
    await settle();
  }
  throw new Error(`Could not highlight "${label}". Last frame:\n${getFrame() ?? '(empty)'}`);
}

/** Accept whatever the Select already has highlighted. */
export async function acceptDefault(stdin: { write: (data: string) => void }): Promise<void> {
  stdin.write(ENTER);
  await settle();
}

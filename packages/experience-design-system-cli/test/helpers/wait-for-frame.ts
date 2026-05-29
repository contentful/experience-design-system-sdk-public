export function waitForFrame(
  getFrame: () => string | undefined,
  condition: (frame: string) => boolean,
  timeout = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const frame = getFrame();
      if (frame && condition(frame)) return resolve(frame);
      if (Date.now() - start > timeout) {
        return reject(
          new Error(`Timed out after ${timeout}ms waiting for frame condition.\nLast frame:\n${frame ?? '(empty)'}`),
        );
      }
      setTimeout(check, 50);
    };
    check();
  });
}

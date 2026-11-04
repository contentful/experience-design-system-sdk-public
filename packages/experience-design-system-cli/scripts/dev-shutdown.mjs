export function stopChildAndWait(child) {
  if (!child || child.closed) return Promise.resolve();

  return new Promise((resolve) => {
    child.once('close', resolve);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  });
}

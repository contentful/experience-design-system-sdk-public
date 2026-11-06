interface Key {
  return: boolean;
  escape: boolean;
}

export type ErrorAction = 'exit' | 'retry' | 'acknowledge' | null;

interface Available {
  canRetry: boolean;
  canAcknowledge: boolean;
}

export function errorAction(input: string, key: Key, available: Available): ErrorAction {
  if (key.return && available.canAcknowledge) return 'acknowledge';
  if (input === 'r' && available.canRetry) return 'retry';
  if (key.return || key.escape) return 'exit';
  return null;
}

export function errorControls(available: Available) {
  return [
    available.canAcknowledge ? { keys: 'Enter', label: 'Acknowledge and apply' } : { keys: 'Enter', label: 'Exit' },
    ...(available.canAcknowledge ? [{ keys: 'Esc', label: 'Exit' }] : []),
    ...(available.canRetry ? [{ keys: 'r', label: 'Re-enter credentials' }] : []),
  ];
}

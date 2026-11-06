interface Key {
  return: boolean;
  escape: boolean;
}

export type ErrorAction = 'exit' | 'retry' | 'acknowledge' | 'open' | null;

interface Available {
  canRetry: boolean;
  canAcknowledge: boolean;
  canOpen: boolean;
}

export function errorAction(input: string, key: Key, available: Available): ErrorAction {
  if (key.return && available.canAcknowledge) return 'acknowledge';
  if (input === 'r' && available.canRetry) return 'retry';
  if (input === 'o' && available.canOpen) return 'open';
  if (key.return || key.escape) return 'exit';
  return null;
}

export function errorControls(available: Available) {
  return [
    available.canAcknowledge ? { keys: 'Enter', label: 'Acknowledge and apply' } : { keys: 'Enter', label: 'Exit' },
    ...(available.canAcknowledge ? [{ keys: 'Esc', label: 'Exit' }] : []),
    ...(available.canRetry ? [{ keys: 'r', label: 'Re-enter credentials' }] : []),
    ...(available.canOpen ? [{ keys: 'o', label: 'Show debug logs in file manager' }] : []),
  ];
}

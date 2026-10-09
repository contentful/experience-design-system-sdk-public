interface Key {
  return: boolean;
  escape: boolean;
}

export type GateAction = 'continue' | 'skip' | 'quit' | null;

export function gateAction(input: string, key: Key, canSkip: boolean): GateAction {
  if (key.return) return 'continue';
  if (input === 'a' && canSkip) return 'skip';
  if (key.escape) return 'quit';
  return null;
}

export function gateControls(continueLabel: string, skipLabel: string, canSkip: boolean) {
  return [
    { keys: 'Enter', label: continueLabel },
    ...(canSkip ? [{ keys: 'a', label: skipLabel }] : []),
    { keys: 'Esc', label: 'Quit' },
  ];
}

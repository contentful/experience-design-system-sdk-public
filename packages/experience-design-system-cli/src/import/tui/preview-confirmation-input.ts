import { useCallback, type Dispatch, type SetStateAction } from 'react';

type PreviewConfirmationKey = {
  return: boolean;
};

type PreviewConfirmationInputOptions = {
  breakingWithImpact: boolean;
  allowDeletions: boolean;
  fetchedAllowDeletions: boolean;
  removedCount: number;
  onConfirm: (acknowledge: boolean, allowDeletions: boolean) => void;
  onToggleAllowDeletions: () => void;
};

export function handlePreviewConfirmationInput(
  input: string,
  key: PreviewConfirmationKey,
  options: PreviewConfirmationInputOptions,
): boolean {
  if (key.return) {
    options.onConfirm(options.breakingWithImpact, options.allowDeletions);
    return true;
  }
  if ((input === 'x' || input === 'X') && options.fetchedAllowDeletions && options.removedCount > 0) {
    options.onToggleAllowDeletions();
    return true;
  }
  return false;
}

export function usePreviewConfirmationInput(
  breakingWithImpact: boolean,
  allowDeletions: boolean,
  fetchedAllowDeletions: boolean,
  removedCount: number,
  onConfirm: (acknowledge: boolean, allowDeletions: boolean) => void,
  setAllowDeletions: Dispatch<SetStateAction<boolean>>,
): (input: string, key: PreviewConfirmationKey) => boolean {
  return useCallback(
    (input, key) =>
      handlePreviewConfirmationInput(input, key, {
        breakingWithImpact,
        allowDeletions,
        fetchedAllowDeletions,
        removedCount,
        onConfirm,
        onToggleAllowDeletions: () => setAllowDeletions((previous) => !previous),
      }),
    [allowDeletions, breakingWithImpact, fetchedAllowDeletions, onConfirm, removedCount, setAllowDeletions],
  );
}

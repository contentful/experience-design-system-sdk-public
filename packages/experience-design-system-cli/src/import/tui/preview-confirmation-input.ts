import { useCallback } from 'react';

type PreviewConfirmationKey = {
  return: boolean;
};

type PreviewConfirmationInputOptions = {
  breakingWithImpact: boolean;
  onConfirm: (acknowledge: boolean) => void;
};

function handlePreviewConfirmationInput(
  _input: string,
  key: PreviewConfirmationKey,
  options: PreviewConfirmationInputOptions,
): boolean {
  if (key.return) {
    options.onConfirm(options.breakingWithImpact);
    return true;
  }
  return false;
}

export function usePreviewConfirmationInput(
  breakingWithImpact: boolean,
  onConfirm: (acknowledge: boolean) => void,
): (input: string, key: PreviewConfirmationKey) => boolean {
  return useCallback(
    (input, key) =>
      handlePreviewConfirmationInput(input, key, {
        breakingWithImpact,
        onConfirm,
      }),
    [breakingWithImpact, onConfirm],
  );
}

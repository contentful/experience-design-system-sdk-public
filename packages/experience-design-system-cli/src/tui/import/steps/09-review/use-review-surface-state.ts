import { useState, type Dispatch, type SetStateAction } from 'react';

export type UseReviewSurfaceStateResult = {
  sidebarFocused: boolean;
  setSidebarFocused: Dispatch<SetStateAction<boolean>>;
  showFinalize: boolean;
  setShowFinalize: Dispatch<SetStateAction<boolean>>;
  showQuit: boolean;
  setShowQuit: Dispatch<SetStateAction<boolean>>;
  finalizeError: string | null;
  setFinalizeError: Dispatch<SetStateAction<string | null>>;
};

export function useReviewSurfaceState(initialFinalizeError: string | null = null): UseReviewSurfaceStateResult {
  const [sidebarFocused, setSidebarFocused] = useState(true);
  const [showFinalize, setShowFinalize] = useState(false);
  const [showQuit, setShowQuit] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(initialFinalizeError);

  return {
    sidebarFocused,
    setSidebarFocused,
    showFinalize,
    setShowFinalize,
    showQuit,
    setShowQuit,
    finalizeError,
    setFinalizeError,
  };
}

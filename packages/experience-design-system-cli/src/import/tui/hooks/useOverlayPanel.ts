import { useCallback, useState } from 'react';

export interface UseOverlayPanelOptions {
  toggleKey: string;
  onClose?: () => void;
}

export interface UseOverlayPanelResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  handleInput: (input: string, key: { escape?: boolean }) => boolean;
}

export function useOverlayPanel(opts: UseOverlayPanelOptions): UseOverlayPanelResult {
  const { toggleKey, onClose } = opts;
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen((prev) => {
      if (prev && onClose) onClose();
      return false;
    });
  }, [onClose]);

  const handleInput = useCallback(
    (input: string, key: { escape?: boolean }): boolean => {
      if (!isOpen) return false;
      if (input === toggleKey || key.escape === true) {
        if (onClose) onClose();
        setIsOpen(false);
        return true;
      }
      return false;
    },
    [isOpen, toggleKey, onClose],
  );

  return { isOpen, open, close, handleInput };
}

import * as React from 'react';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose?: () => void;
  dismissible?: boolean;
  children?: React.ReactNode;
}

export function Modal(props: ModalProps): React.ReactElement | null {
  const { open, title, onClose, dismissible = true, children } = props;
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true">
      <header>
        <h2>{title}</h2>
        {dismissible ? <button onClick={onClose}>Close</button> : null}
      </header>
      <div>{children}</div>
    </div>
  );
}

import * as React from 'react';

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface ToastProps {
  message: string;
  severity?: ToastSeverity;
  duration?: number;
  onDismiss?: () => void;
}

export function Toast(props: ToastProps): React.ReactElement {
  const { message, severity = 'info', duration = 3000, onDismiss } = props;
  return (
    <div role="status" data-severity={severity} data-duration={duration}>
      <span>{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

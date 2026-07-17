import type { ReactElement, ReactNode } from 'react';

export interface AriaLiveRegionPortalProps {
  container?: HTMLElement;
  children: ReactNode;
}

export function AriaLiveRegionPortal({ container, children }: AriaLiveRegionPortalProps): ReactElement {
  void container;
  return <>{children}</>;
}

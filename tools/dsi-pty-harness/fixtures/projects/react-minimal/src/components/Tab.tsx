import * as React from 'react';

export interface TabProps {
  id: string;
  label: string;
  active?: boolean;
  onSelect?: (id: string) => void;
  children?: React.ReactNode;
}

export function Tab(props: TabProps): React.ReactElement {
  const { id, label, active = false, onSelect, children } = props;
  return (
    <div role="tab" aria-selected={active}>
      <button onClick={() => onSelect?.(id)}>{label}</button>
      {active ? <div role="tabpanel">{children}</div> : null}
    </div>
  );
}

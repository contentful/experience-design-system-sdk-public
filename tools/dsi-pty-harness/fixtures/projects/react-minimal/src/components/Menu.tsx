import * as React from 'react';

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface MenuProps {
  items: MenuItem[];
  onSelect?: (id: string) => void;
  ariaLabel?: string;
  children?: React.ReactNode;
}

export function Menu(props: MenuProps): React.ReactElement {
  const { items, onSelect, ariaLabel, children } = props;
  return (
    <ul role="menu" aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.id} aria-disabled={item.disabled}>
          <button onClick={() => onSelect?.(item.id)} disabled={item.disabled}>
            {item.label}
          </button>
        </li>
      ))}
      {children}
    </ul>
  );
}

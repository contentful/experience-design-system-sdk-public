import { createContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

const ThemeContext = createContext<'light' | 'dark'>('light');

export interface ThemeContextProviderProps {
  children: ReactNode;
}

export function ThemeContextProvider({ children }: ThemeContextProviderProps): ReactElement {
  return <ThemeContext.Provider value="light">{children}</ThemeContext.Provider>;
}

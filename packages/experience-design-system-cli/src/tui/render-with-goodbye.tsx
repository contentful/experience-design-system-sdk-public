import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { render, Text, useInput, type Instance, type RenderOptions } from 'ink';

const GOODBYE_RENDER_DELAY_MS = 50;

const ScreenTransitionClearContext = createContext<() => void>(() => undefined);

export function useScreenTransitionClear(): () => void {
  return useContext(ScreenTransitionClearContext);
}

export function GoodbyeBoundary({ children }: { children: React.ReactNode }): React.ReactElement {
  const [isExiting, setIsExiting] = useState(false);
  const isExitingRef = useRef(false);
  const exitTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const requestExit = useCallback((): void => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    setIsExiting(true);
    exitTimerRef.current = setTimeout(() => process.exit(0), GOODBYE_RENDER_DELAY_MS);
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') requestExit();
  });

  useEffect(() => {
    process.on('SIGINT', requestExit);
    return () => {
      process.off('SIGINT', requestExit);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [requestExit]);

  return isExiting ? <Text>Goodbye!</Text> : <>{children}</>;
}

export function renderWithGoodbye(element: React.ReactElement, options?: RenderOptions): Instance {
  let instance: Instance | undefined;
  const clearScreen = (): void => {
    instance?.clear();
  };
  instance = render(
    <ScreenTransitionClearContext.Provider value={clearScreen}>
      <GoodbyeBoundary>{element}</GoodbyeBoundary>
    </ScreenTransitionClearContext.Provider>,
    {
      ...options,
      exitOnCtrlC: false,
    },
  );
  return instance;
}

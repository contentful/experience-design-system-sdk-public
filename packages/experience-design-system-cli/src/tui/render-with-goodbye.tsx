import React, { useEffect, useRef, useState } from 'react';
import { render, Text, type Instance, type RenderOptions } from 'ink';

const GOODBYE_RENDER_DELAY_MS = 50;

export function GoodbyeBoundary({ children }: { children: React.ReactNode }): React.ReactElement {
  const [isExiting, setIsExiting] = useState(false);
  const isExitingRef = useRef(false);

  useEffect(() => {
    let exitTimer: NodeJS.Timeout | undefined;
    const handleSigint = (): void => {
      if (isExitingRef.current) return;
      isExitingRef.current = true;
      setIsExiting(true);
      exitTimer = setTimeout(() => process.exit(0), GOODBYE_RENDER_DELAY_MS);
    };

    process.on('SIGINT', handleSigint);
    return () => {
      process.off('SIGINT', handleSigint);
      if (exitTimer) clearTimeout(exitTimer);
    };
  }, []);

  return isExiting ? <Text>Goodbye!</Text> : <>{children}</>;
}

export function renderWithGoodbye(element: React.ReactElement, options?: RenderOptions): Instance {
  return render(<GoodbyeBoundary>{element}</GoodbyeBoundary>, {
    ...options,
    exitOnCtrlC: false,
  });
}

import { useEffect, useState } from 'react';
import { Spinner } from '@inkjs/ui';

export function useTimedSpinner(): {
  spinner: React.ReactElement;
  elapsed: string;
} {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;

  return {
    spinner: <Spinner />,
    elapsed: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
  };
}

import { useEffect, useState } from 'react';
import { formatElapsed } from './logic.js';

export function useElapsed(): string {
  const [startedAt] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return formatElapsed(seconds);
}

import { useEffect, useState } from 'react';
import { formatElapsed } from './logic.js';

export function useElapsed(): string {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return formatElapsed(seconds);
}

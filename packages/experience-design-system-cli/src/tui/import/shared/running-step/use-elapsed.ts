import { useEffect, useRef, useState } from 'react';
import { formatElapsed } from './logic.js';

export function useElapsedSeconds(active = true): number {
  const accumulated = useRef(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(Math.floor(accumulated.current / 1000));
      return;
    }
    const startedAt = Date.now();
    const update = () => setSeconds(Math.floor((accumulated.current + Math.max(0, Date.now() - startedAt)) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => {
      accumulated.current += Math.max(0, Date.now() - startedAt);
      clearInterval(timer);
    };
  }, [active]);

  return seconds;
}

export function useElapsed(): string {
  return formatElapsed(useElapsedSeconds());
}

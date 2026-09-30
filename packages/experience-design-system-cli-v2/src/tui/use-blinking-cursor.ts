import { useEffect, useState } from 'react';

const BLINK_INTERVAL_MS = 500;

/** Toggles every half second; use it to blink a text cursor. */
export function useBlinkingCursor(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setVisible((current) => !current), BLINK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return visible;
}

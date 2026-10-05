import { useEffect, useState } from 'react';

export function useBlinkingCursor(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setVisible((current) => !current), 500);
    return () => clearInterval(interval);
  }, []);

  return visible;
}

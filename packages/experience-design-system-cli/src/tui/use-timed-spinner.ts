import { useEffect, useState } from 'react';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function useTimedSpinner(): {
  spinner: string;
  secondarySpinner: string;
  elapsed: string;
} {
  const [frame, setFrame] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const spinner = setInterval(() => setFrame((current) => (current + 1) % SPINNER_FRAMES.length), 80);
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => {
      clearInterval(spinner);
      clearInterval(timer);
    };
  }, []);

  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;

  return {
    spinner: SPINNER_FRAMES[frame]!,
    secondarySpinner: SPINNER_FRAMES[(frame + 5) % SPINNER_FRAMES.length]!,
    elapsed: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`,
  };
}

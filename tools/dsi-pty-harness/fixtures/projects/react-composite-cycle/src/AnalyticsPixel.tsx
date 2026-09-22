import { useEffect } from 'react';

function track(event: string): void {
  void event;
}

export interface AnalyticsPixelProps {
  event: string;
}

export function AnalyticsPixel({ event }: AnalyticsPixelProps): null {
  useEffect(() => {
    track(event);
  }, [event]);
  return null;
}

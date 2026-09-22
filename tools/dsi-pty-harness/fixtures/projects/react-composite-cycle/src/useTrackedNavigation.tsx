import { useCallback } from 'react';

export function useTrackedNavigation(): (destination: string) => void {
  return useCallback((destination: string) => {
    void destination;
  }, []);
}

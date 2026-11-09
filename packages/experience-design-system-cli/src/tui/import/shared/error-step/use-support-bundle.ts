import { useEffect, useState } from 'react';
import { bundleDebugLogs, type SupportBundle } from '@tui/support-bundle.js';

/** Zips this session's debug logs once, when an error screen appears. Undefined until that is done. */
export function useSupportBundle(): SupportBundle | undefined {
  const [bundle, setBundle] = useState<SupportBundle>();

  useEffect(() => {
    let active = true;
    void bundleDebugLogs().then((result) => {
      if (active) setBundle(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return bundle;
}

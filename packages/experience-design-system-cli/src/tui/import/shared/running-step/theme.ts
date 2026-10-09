import { defaultTheme, extendTheme } from '@inkjs/ui';
import type { TextProps } from 'ink';

export const PROGRESS_THEME = extendTheme(defaultTheme, {
  components: {
    ProgressBar: {
      styles: {
        completed: (): TextProps => ({ color: 'blue' }),
      },
    },
  },
});

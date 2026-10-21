import { defaultTheme, extendTheme } from '@inkjs/ui';
import type { TextProps } from 'ink';
import { PALETTE } from '@tui/theme.js';

export const PROGRESS_THEME = extendTheme(defaultTheme, {
  components: {
    ProgressBar: {
      styles: {
        completed: (): TextProps => ({ color: PALETTE.accent }),
      },
    },
  },
});

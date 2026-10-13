import type { TextProps } from 'ink';
import { defaultTheme, extendTheme } from '@inkjs/ui';
import { PALETTE as REVIEW } from '../09-review/theme.js';

// The flow's colours. The review's, plus `link`, which only the push result uses to show where the design system now
// is. Same values as legacy's PALETTE, so nothing looks different.
export const PALETTE = {
  ...REVIEW,
  link: '#58A6FF',
} as const;

// Legacy's @inkjs/ui theme: the same as the default, with the progress bar drawn in blue.
export const INK_UI_THEME = extendTheme(defaultTheme, {
  components: {
    ProgressBar: {
      styles: {
        completed: (): TextProps => ({
          color: 'blue',
        }),
      },
    },
  },
});

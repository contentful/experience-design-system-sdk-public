import { designTokens, foregroundForBackground } from "@/lib/design-tokens";

/**
 * Canonical example of the pattern every primitive in this folder follows:
 * take a handful of props, resolve each one through a `design-tokens.ts`
 * helper (or, here, a per-size preset built from `designTokens`), and apply
 * the result as a plain inline `style` object. There's deliberately no
 * generic `style`/`className` prop — an Experience can only set the specific
 * props a component declares, so it can't push arbitrary CSS through a
 * component that wasn't designed for it.
 */
const SIZES = {
  sm: {
    radius: designTokens["radius.sm"],
    spacing: designTokens["spacing.xs"],
    text: designTokens["text.sm"],
  },
  md: {
    radius: designTokens["radius.md"],
    spacing: designTokens["spacing.sm"],
    text: designTokens["text.md"],
  },
  lg: {
    radius: designTokens["radius.lg"],
    spacing: designTokens["spacing.lg"],
    text: designTokens["text.lg"],
  },
} as const;

export function Button({
  label = "Button",
  url,
  color = designTokens["color.primary"],
  size = "md",
}: {
  label?: string;
  url?: string;
  color?: string;
  size?: keyof typeof SIZES;
}) {
  const className = "inline-flex items-center justify-center font-medium";
  const preset = SIZES[size];
  const style = {
    backgroundColor: color,
    // Auto-picks a readable foreground for whatever background color was set,
    // instead of taking a separate text-color prop — see FOREGROUND_BY_BACKGROUND.
    color: foregroundForBackground(color),
    borderRadius: preset.radius,
    padding: preset.spacing,
    fontSize: preset.text,
  };

  // Same className/style either way — an <a> when there's a destination, a
  // plain <button> otherwise, so this one component covers both link and
  // action buttons in an Experience.
  return url ? (
    <a href={url} className={className} style={style}>
      {label}
    </a>
  ) : (
    <button type="button" className={className} style={style} text="Actual text we parse">
      Content could belong here // But DSI ignores this
    </button>
  );
}

/**
 * Design token bridge between Contentful Experiences and this app.
 *
 * Two layers to keep in sync when you change the design system:
 *
 * 1. `app/globals.css` (@theme) — actual values (colors, spacing, etc.)
 * 2. `designTokens` (below)      — Contentful token id → CSS var reference
 *
 * Token-type props from Contentful (e.g. Button `color`) are resolved by
 * `resolveDesignToken` in experience-config before they reach primitives.
 * Enum props (e.g. Text `size: "sm"`) arrive as a bare key instead of a full
 * token id, and are resolved by the category-specific helpers further down
 * (`resolveColor`, `textSize`, `borderRadius`, `spacing`), all built on the
 * shared `resolveByPrefix` lookup.
 */

/** Contentful token id → CSS custom property. Values are defined in globals.css. */
export const designTokens = {
  "color.primary": "var(--color-primary)",
  "color.primaryForeground": "var(--color-primary-foreground)",
  "color.secondary": "var(--color-secondary)",
  "color.secondaryForeground": "var(--color-secondary-foreground)",
  "color.tertiary": "var(--color-tertiary)",
  "color.tertiaryForeground": "var(--color-tertiary-foreground)",
  "color.foreground": "var(--color-foreground)",
  "color.background": "var(--color-background)",
  "color.muted": "var(--color-muted)",
  "color.border": "var(--color-border)",
  "spacing.xs": "var(--spacing-xs)",
  "spacing.sm": "var(--spacing-sm)",
  "spacing.md": "var(--spacing-md)",
  "spacing.lg": "var(--spacing-lg)",
  "spacing.xl": "var(--spacing-xl)",
  "text.sm": "var(--text-sm)",
  "text.md": "var(--text-md)",
  "text.lg": "var(--text-lg)",
  "text.xl": "var(--text-xl)",
  "radius.sm": "var(--radius-sm)",
  "radius.md": "var(--radius-md)",
  "radius.lg": "var(--radius-lg)",
} as const satisfies Record<string, string>;

export type DesignToken = keyof typeof designTokens;
export type ColorToken = Extract<DesignToken, `color.${string}`>;
export type SpacingToken = Extract<DesignToken, `spacing.${string}`>;
export type TextSizeToken = Extract<DesignToken, `text.${string}`>;
export type RadiusToken = Extract<DesignToken, `radius.${string}`>;

/** Pairs background colors with readable foreground text on top. */
const FOREGROUND_BY_BACKGROUND = new Map<string, string>([
  [designTokens["color.primary"], designTokens["color.primaryForeground"]],
  [designTokens["color.secondary"], designTokens["color.secondaryForeground"]],
  [designTokens["color.tertiary"], designTokens["color.tertiaryForeground"]],
  [designTokens["color.foreground"], designTokens["color.background"]],
]);

/**
 * Passed to `experienceConfig.resolveToken`. The SDK calls this for every
 * design-token prop before rendering a component — `token.value` is always a
 * full token id here (e.g. "color.primary"), never a bare enum key, so the
 * cast below is unvalidated but immediately guarded by the `in` check.
 */
export function resolveDesignToken(token: {
  value: string;
}): string | undefined {
  const id = token.value as DesignToken;
  return id in designTokens ? designTokens[id] : undefined;
}

/**
 * Shared lookup behind the four helpers below. A prop value can arrive as an
 * already-resolved CSS var (`"var(--color-primary)"`), a full token id
 * (`"color.primary"`), or a bare enum key (`"primary"`) — Contentful sends
 * enum keys for enum-typed properties, and every enum key happens to match
 * the suffix of a real token id, so `` `${prefix}.${value}` `` re-derives it
 * instead of hand-maintaining a separate enum → value table per category.
 */
function resolveByPrefix(
  prefix: string,
  value: string,
  { warnOnMiss = true }: { warnOnMiss?: boolean } = {},
): string | undefined {
  if (value.startsWith("var(")) return value;
  if (value in designTokens) return designTokens[value as DesignToken];
  const id = `${prefix}.${value}` as DesignToken;
  if (id in designTokens) return designTokens[id];
  if (warnOnMiss && process.env.NODE_ENV !== "production") {
    console.warn(`[design-tokens] no "${prefix}" token for value "${value}"`);
  }
  return undefined;
}

/** Readable text color for a given background (token id, enum, or resolved CSS var). */
export function foregroundForBackground(background: string): string {
  const bg = resolveByPrefix("color", background);
  if (!bg) return designTokens["color.foreground"];
  return FOREGROUND_BY_BACKGROUND.get(bg) ?? designTokens["color.foreground"];
}

/** Resolves any single color value (token id, enum, or CSS var) — used for both text and background colors. */
export function resolveColor(value?: string): string | undefined {
  if (!value) return undefined;
  return resolveByPrefix("color", value);
}

export function textSize(value?: string): string | undefined {
  if (!value) return undefined;
  return resolveByPrefix("text", value);
}

export function borderRadius(value?: string): string | undefined {
  if (!value) return undefined;
  return resolveByPrefix("radius", value);
}

/**
 * Unlike the other three helpers, an unresolved value falls back to itself
 * instead of `undefined`: spacing is a plain CSS length, so a custom value
 * like "1.25rem" is harmless to pass straight through, whereas an unresolved
 * color/size/radius enum would rather disappear than render nonsense.
 */
export function spacing(value: string): string {
  return resolveByPrefix("spacing", value, { warnOnMiss: false }) ?? value;
}

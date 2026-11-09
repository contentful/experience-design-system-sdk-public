import type { ReactNode } from "react";
import {
  designTokens,
  foregroundForBackground,
  resolveColor,
  spacing,
} from "@/lib/design-tokens";

// Same prop → design-tokens.ts helper → style pattern as Button.tsx.
export function Flex({
  direction = "row",
  // Renamed on destructure so the prop doesn't shadow the imported `spacing()` helper below.
  spacing: spacingProp = designTokens["spacing.md"],
  backgroundColor,
  children,
}: {
  direction?: "row" | "column";
  spacing?: string;
  backgroundColor?: string;
  children?: ReactNode;
}) {
  const space = spacing(spacingProp);
  const bg = backgroundColor ? resolveColor(backgroundColor) : undefined;

  return (
    <div
      // Row: equal-width children that can shrink (min-w-0). Column: stack only.
      className={
        direction === "row"
          ? "flex min-w-0 *:min-w-0 *:flex-1"
          : "flex min-w-0"
      }
      style={{
        flexDirection: direction,
        gap: space,
        padding: space,
        backgroundColor: bg,
        color: bg ? foregroundForBackground(backgroundColor!) : undefined,
      }}
    >
      {children}
    </div>
  );
}

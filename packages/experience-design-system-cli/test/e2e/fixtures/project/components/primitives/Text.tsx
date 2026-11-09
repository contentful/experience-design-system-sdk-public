import { resolveColor, textSize } from "@/lib/design-tokens";

// Same prop → design-tokens.ts helper → style pattern as Button.tsx.
type Tag = "p" | "span" | "h1" | "h2" | "h3";

export function Text({
  text = "",
  // Destructured and capitalized so `as` can be used directly as a dynamic
  // JSX tag below — JSX requires component/tag names to start uppercase.
  as: Tag = "p",
  size,
  color,
}: {
  text?: string;
  as?: Tag;
  size?: string;
  color?: string;
}) {
  return (
    <Tag
      style={{
        fontSize: textSize(size),
        color: resolveColor(color),
      }}
    >
      {text}
    </Tag>
  );
}

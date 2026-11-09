import { borderRadius } from "@/lib/design-tokens";

// Same prop → design-tokens.ts helper → style pattern as Button.tsx, except
// `radius` is the only prop on the design system's token scale here —
// `maxWidth`/`maxHeight` are free-form CSS lengths (not a fixed set of sizes
// like radius/spacing/text), so they're passed straight through as raw CSS.
export function Image({
  src,
  alt = "",
  radius,
  maxWidth,
  maxHeight,
}: {
  src: string;
  alt?: string;
  radius?: string;
  maxWidth?: string;
  maxHeight?: string;
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      className="block h-auto min-w-0 max-w-full"
      style={{
        borderRadius: borderRadius(radius),
        maxWidth,
        maxHeight,
      }}
    />
  );
}

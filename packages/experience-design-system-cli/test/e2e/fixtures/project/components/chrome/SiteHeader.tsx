import { Flex } from "@/components/primitives/Flex";
import { Image } from "@/components/primitives/Image";
import { Text } from "@/components/primitives/Text";
import { Button } from "@/components/primitives/Button";

// Deliberately hardcoded, non-CMS-driven chrome — unlike the primitives in
// components/primitives, this isn't registered with the Experience Builder,
// so it doesn't need to go through design-tokens.ts helpers and can reach
// for the raw `var(--color-*)` custom properties from globals.css directly.
export function SiteHeader({
  // Set in app/[locale]/[id]/layout.tsx via next/headers `draftMode()` and
  // passed down, rather than read here.
  draftMode,
}: {
  draftMode: boolean;
}) {
  return (
    <header className="border-b" style={{ borderColor: "var(--color-border)" }}>
      {draftMode && (
        <div
          className="flex items-center justify-center gap-4 px-4 py-2"
          style={{ background: "var(--color-muted)" }}
        >
          <Text text="⚠️ Draft Mode is on" />
          <Button label="Exit draft mode" size="sm" url="/api/draft/disable" />
        </div>
      )}
      <div className="flex items-center justify-between px-4 py-3">
        <Image src="/contentful-logo.svg" alt="Contentful" maxHeight="2rem" />
        <Flex direction="row" spacing="spacing.xs">
          <Button size="sm" label="Home" url="/" />
          <Button size="sm" label="About" url="/about" />
        </Flex>
      </div>
    </header>
  );
}

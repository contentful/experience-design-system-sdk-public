import { Text } from "@/components/primitives/Text";

// Deliberately hardcoded, non-CMS-driven chrome — see SiteHeader.tsx.
export function SiteFooter() {
  return (
    <footer
      className="border-t px-4 py-6"
      style={{ borderColor: "var(--color-border)" }}
    >
      <Text text={`© ${new Date().getFullYear()} Contentful`} as="span" />
    </footer>
  );
}

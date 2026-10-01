---
name: ink-ui
description: @inkjs/ui component reference for v2 TUI development
---

# @inkjs/ui Components Reference

Official Ink UI components for building interactive terminal interfaces. Use these instead of building from scratch when possible.

---

## Select

Dropdown/menu selector. User navigates with arrow keys, selects with Enter.

```tsx
import { Select } from "@inkjs/ui";

export function FrameworkPicker() {
  const [selected, setSelected] = useState<string>("react");

  return (
    <Select
      items={[
        { label: "React", value: "react" },
        { label: "Vue", value: "vue" },
        { label: "Astro", value: "astro" },
      ]}
      value={selected}
      onChange={setSelected}
    />
  );
}
```

**Props**:

- `items`: Array of `{ label: string; value: T; key?: string }`
- `value`: Currently selected value
- `onChange`: Callback when selection changes
- `isFocused`: Boolean (if false, can't change)
- `limit`: Max visible items before scrolling (default: show all)
- `visibleOptionCount`: Alias for `limit`
- `indicatorComponent`: Custom selection indicator (default: "❯ ")

**Events**:

```tsx
onChange={(value) => {
  console.log('Selected:', value);
}}
```

---

## TextInput

Single-line text entry.

```tsx
import { TextInput } from "@inkjs/ui";
import { useState } from "react";

export function CredentialsForm() {
  const [spaceId, setSpaceId] = useState("");

  return (
    <TextInput
      value={spaceId}
      onChange={setSpaceId}
      placeholder="Enter Space ID..."
      focus
    />
  );
}
```

**Props**:

- `value`: Current input value
- `onChange`: Callback on text change
- `placeholder`: Hint text (shown in gray when empty)
- `focus`: Boolean (auto-focus on mount)
- `mask`: Character to use instead of text (e.g., "\*" for passwords)
- `showCursor`: Boolean (default: true)
- `cursorStyle`: CSS-like string for cursor appearance

**Example — Password input**:

```tsx
<TextInput
  value={token}
  onChange={setToken}
  mask="*"
  placeholder="Enter API token..."
/>
```

---

## Spinner

Animated spinner for long-running tasks.

```tsx
import { Spinner } from "@inkjs/ui";

export function ExtractingStep() {
  return (
    <Box flexDirection="column" gap={1}>
      <Spinner type="dots" />
      <Text>Analyzing your codebase...</Text>
    </Box>
  );
}
```

**Props**:

- `type`: Spinner animation type:
  - `"dots"` (default): ⠋ ⠙ ⠹ ...
  - `"dots2"`: ⣾ ⣽ ⣻ ...
  - `"dots3"`: ⠋ ⠙ ⠚ ...
  - `"dots4"`: ⠄ ⠆ ⠇ ...
  - `"dots5"`: ⠋ ⠙ ⠚ ⠞ ⠖ ⠦ ⠴ ⠲ ⠳ ⠓ ...
  - `"dots6"`: ⠀ ⠠ ⠐ ⠈ ...
  - `"line"`: - \ | /
  - `"line2"`: ⠂ - – ‐
  - `"pipe"`: ┤ ┘ ┴ └ ├ ┌ ┬ ┐
  - `"simpleDots"`: . o 0
  - `"simpleDotsScrolling"`: . o O o
  - `"star"`: ✶ ✸ ✹ ✺ ✹ ✷
  - `"star2"`: + x \*
  - `"flip"`: \_\_ ‾‾
  - `"hamburger"`: ☱ ☲ ☴
  - `"growVertical"`: ▁ ▃ ▄ ▅ ▆ ▇ █ ▇ ▆ ▅ ▄ ▃
  - `"growHorizontal"`: ▏ ▎ ▍ ▌ ▋ ▊ ▉ ▊ ▋ ▌ ▍ ▎
  - `"balloon"`: ( . ) o
  - `"balloon2"`: . o O . . o O . .
  - `"noise"`: ▓ ▒ ░
  - `"bounce"`: ⠁ ⠂ ⠄ ⠂
  - `"boxBounce"`: ▖ ▘ ▝ ▗
  - `"boxBounce2"`: ▌ ▀ ▐ ▄
  - `"triangle"`: ◢ ◣ ◤ ◥
  - `"arc"`: ◜ ◠ ◝ ◞ ◡ ◟
  - `"circle"`: ◡ ⊙ ◠
  - `"squareCorners"`: ◰ ◳ ◲ ◱
  - `"circleQuarters"`: ◴ ◷ ◶ ◵
  - `"circleHalves"`: ◐ ◓ ◑ ◒
  - `"squish"`: ╫ ╪
- `label`: Optional text after spinner

---

## ProgressBar

Visual progress indicator.

```tsx
import { ProgressBar } from "@inkjs/ui";
import { useState, useEffect } from "react";

export function GeneratingStep() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((p) => Math.min(p + 5, 100));
    }, 200);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Generating components...</Text>
      <ProgressBar value={progress} total={100} />
      <Text color="gray">{progress}%</Text>
    </Box>
  );
}
```

**Props**:

- `value`: Current progress (0–100 or custom)
- `total`: Max value (default: 100)
- `percent`: Boolean — show as percentage (default: true)
- `character`: Fill character (default: "█")
- `background`: Empty character (default: "░")

---

## Confirm

Yes/No confirmation prompt. User navigates with arrow keys, selects with Enter.

```tsx
import { Confirm } from "@inkjs/ui";
import { useState } from "react";

export function DeleteConfirmation() {
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  if (confirmed === null) {
    return (
      <Confirm
        isSelected={(answer) => answer === confirmed}
        onConfirm={(answer) => setConfirmed(answer)}
      >
        Delete all components?
      </Confirm>
    );
  }

  return <Text>{confirmed ? "Deleting..." : "Cancelled"}</Text>;
}
```

**Props**:

- `isSelected`: (answer: boolean) => boolean — Highlights the selected option
- `onConfirm`: (answer: boolean) => void — Called when user presses Enter

**Children**: Prompt text

---

## Combinations

### Multi-step Form

```tsx
import { Select, TextInput, Confirm } from "@inkjs/ui";
import { useState } from "react";

export function SetupWizard() {
  const [step, setStep] = useState<"framework" | "path" | "confirm">(
    "framework",
  );
  const [framework, setFramework] = useState("react");
  const [path, setPath] = useState(".");
  const [confirmed, setConfirmed] = useState(false);

  if (step === "framework") {
    return (
      <Box flexDirection="column">
        <Text bold>Step 1: Choose Framework</Text>
        <Select
          items={[
            { label: "React", value: "react" },
            { label: "Vue", value: "vue" },
          ]}
          value={framework}
          onChange={(val) => {
            setFramework(val);
            setStep("path");
          }}
        />
      </Box>
    );
  }

  if (step === "path") {
    return (
      <Box flexDirection="column">
        <Text bold>Step 2: Project Path</Text>
        <TextInput
          value={path}
          onChange={setPath}
          placeholder="/path/to/project"
          focus
        />
        <Text color="gray">(Press Enter to continue)</Text>
      </Box>
    );
  }

  if (step === "confirm") {
    return (
      <Box flexDirection="column">
        <Text bold>Confirm Settings</Text>
        <Text>Framework: {framework}</Text>
        <Text>Path: {path}</Text>
        <Confirm
          isSelected={(answer) => answer === confirmed}
          onConfirm={(answer) => {
            if (answer) {
              // Proceed with import
            }
          }}
        >
          Proceed?
        </Confirm>
      </Box>
    );
  }
}
```

### Custom Select with Icons

```tsx
import { Select } from "@inkjs/ui";
import { Text, Box } from "ink";

const items = [
  {
    label: (
      <Box>
        <Text color="green">✓</Text>
        <Text> React (recommended)</Text>
      </Box>
    ),
    value: "react",
  },
  {
    label: (
      <Box>
        <Text color="gray">○</Text>
        <Text> Vue</Text>
      </Box>
    ),
    value: "vue",
  },
];

export function FrameworkSelect() {
  const [selected, setSelected] = useState("react");

  return <Select items={items} value={selected} onChange={setSelected} />;
}
```

---

## Styling

All components support basic Ink styling:

```tsx
<TextInput
  value={input}
  onChange={setInput}
  placeholder="Enter value..."
  // No built-in color props; wrap in <Text> if needed
/>

// For colored input:
<Text color="cyan">
  <TextInput
    value={input}
    onChange={setInput}
  />
</Text>
```

---

## Common Patterns

### Loading State

```tsx
const [isLoading, setIsLoading] = useState(true);

return (
  <Box flexDirection="column">
    {isLoading ? (
      <Box gap={1}>
        <Spinner type="dots" />
        <Text>Loading credentials...</Text>
      </Box>
    ) : (
      <Confirm onConfirm={(answer) => console.log(answer)}>Continue?</Confirm>
    )}
  </Box>
);
```

### Disabled State

```tsx
const isValid = !!spaceId && !!token;

return (
  <Box onClick={() => isValid && onSubmit()}>
    <Text color={isValid ? "cyan" : "gray"}>
      {isValid ? "→ Continue" : "  (enter both fields)"}
    </Text>
  </Box>
);
```

---

## Gotchas

- **Select doesn't auto-close** — You control when to move to next step
- **TextInput doesn't submit on Enter** — Wrap in a component that listens via `useInput`
- **Spinner is just visual** — Doesn't block; pair with state to disable other inputs
- **No built-in validation** — Handle in your onChange callbacks
- **ProgressBar is manual** — You update the value; it doesn't auto-advance

---

## Resources

- **@inkjs/ui GitHub**: https://github.com/vadimdemedes/ink/tree/master/packages/ui
- **Examples**: https://github.com/vadimdemedes/ink/blob/master/packages/ui/src/__tests__/

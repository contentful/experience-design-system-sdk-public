---
name: ink-api
description: Ink core API reference for building TUI components in v2
---

# Ink API Reference

Core Ink (React for terminals) API for v2 TUI development.

## Basic Components

### Box

Container for layout using Flexbox.

```tsx
import { Box } from "ink";

<Box flexDirection="column" padding={2} borderStyle="round" borderColor="cyan">
  <Text>Content</Text>
</Box>;
```

**Props**:

- `flexDirection`: "row" | "column" (default: "row")
- `padding`: number (all sides) or { paddingX, paddingY, paddingLeft, ... }
- `gap`: number (space between children)
- `margin`: number or object
- `width`: number (columns)
- `height`: number (rows)
- `borderStyle`: "round" | "bold" | "double" | "single" | "dashed" | "dotted"
- `borderColor`: color name or hex (see Colors below)
- `backgroundColor`: color name or hex

### Text

Render text with optional styling.

```tsx
import { Text } from "ink";

<Text bold color="green" dimColor>
  Success!
</Text>;
```

**Props**:

- `color`: text color (see Colors below)
- `backgroundColor`: background color
- `bold`: boolean
- `italic`: boolean
- `dimColor`: boolean (gray out)
- `inverse`: boolean (swap fg/bg)
- `underline`: boolean
- `strikethrough`: boolean

### Newline

Add a line break.

```tsx
<Box flexDirection="column">
  <Text>Line 1</Text>
  <Newline />
  <Text>Line 3 (line 2 was blank)</Text>
</Box>
```

---

## Colors

Use any of these color names:

```
black, red, green, yellow, blue, magenta, cyan, white,
gray, redBright, greenBright, yellowBright, blueBright,
magentaBright, cyanBright, whiteBright
```

Or hex:

```tsx
<Text color="#06b6d4">Cyan text</Text>
<Text backgroundColor="#1e293b">Dark bg</Text>
```

---

## Hooks

### useInput

Listen to keyboard input.

```tsx
import { useInput } from "ink";

export function MyComponent() {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.backspace) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (input.length === 1 && input.charCodeAt(0) >= 32) {
      setValue((v) => v + input);
    }
  });

  return <Text>{value}</Text>;
}
```

**key object**:

- `return`, `escape`, `tab`, `space`, `backspace`, `delete`
- `upArrow`, `downArrow`, `leftArrow`, `rightArrow`
- `pageUp`, `pageDown`, `home`, `end`
- `shift`, `meta`, `ctrl`, `alt` (boolean modifiers)

### useApp

Get app-level controls.

```tsx
import { useApp } from "ink";

export function ExitButton() {
  const { exit } = useApp();

  return (
    <Box onClick={() => exit()}>
      <Text>Quit</Text>
    </Box>
  );
}
```

**Methods**:

- `exit(error?: Error)`: Exit the app with optional error code

### useStderr / useStdout

Write directly to stderr/stdout without rendering.

```tsx
import { useStderr } from "ink";

export function Logger() {
  const { write } = useStderr();

  useEffect(() => {
    write("[INFO] Something happened\n");
  }, []);

  return null; // Don't render anything
}
```

---

## useRender

Hook into the render lifecycle.

```tsx
import { useRender } from "ink";

export function MyComponent() {
  useRender(({ stdout, stderr, exit }) => {
    // Called on every render
    // stdout.write(), stderr.write(), exit()
  });

  return <Text>Content</Text>;
}
```

---

## Styling Patterns

### Centering Text

```tsx
<Box justifyContent="center" width={80}>
  <Text>Centered</Text>
</Box>
```

### Padding & Margins

```tsx
// Shorthand: all sides
<Box padding={2}>

// Specific sides
<Box paddingX={2} paddingY={1}>

// Or object
<Box padding={{ left: 1, right: 1, top: 0, bottom: 0 }}>
```

### Borders

```tsx
<Box borderStyle="round" borderColor="cyan" padding={1}>
  <Text>Boxed content</Text>
</Box>
```

### Dividers

```tsx
<Box borderBottomStyle="single" borderBottomColor="gray" marginBottom={1}>
  <Text>Title</Text>
</Box>
```

---

## Common Patterns

### Simple Form Input

```tsx
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

export function TextPrompt({ prompt, onSubmit }) {
  const [input, setInput] = useState('');

  useInput((char, key) => {
    if (key.return) {
      onSubmit(input);
    } else if (key.backspace) {
      setInput((v) => v.slice(0, -1));
    } else if (char && char.charCodeAt(0) >= 32) {
      setInput((v) => v + char);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{prompt}</Text>
      <Text color="cyan">> {input}</Text>
    </Box>
  );
}
```

---

## Debugging

### Check Terminal Size

```tsx
const cols = process.stdout.columns ?? 80;
const rows = process.stdout.rows ?? 24;
```

## Gotchas

- **No hover/mouse events** — Only keyboard input via `useInput`
- **Render on every frame** — Keep computations light; move heavy work outside render
- **Flexbox quirks** — Widths/heights are in columns/rows, not pixels
- **No nested useInput** — Only one component should listen per input event
- **Color support varies** — Check `process.env.TERM` if colors aren't displaying

---

## Resources

- **Ink GitHub**: https://github.com/vadimdemedes/ink
- **Ink API docs**: https://github.com/vadimdemedes/ink/blob/master/readme.md
- **Examples**: https://github.com/vadimdemedes/ink/tree/master/examples

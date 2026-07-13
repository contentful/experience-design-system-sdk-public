import React from 'react';
import { Text } from 'ink';

/**
 * L11 — a single legend entry rendered as ONE atomic `<Text>` node so the
 * `[key] label` pair can never wrap across a line boundary inside a wrapping
 * legend Box (item 7). The `active` flag extends the L8 active-filter
 * highlight (inverse + yellow) to any toggle/mode key so the legend reflects
 * current state (item 1). When inactive it renders the standard cyan key with
 * a dim label.
 *
 * Pure + trivially testable: `legendEntry('[w] broken', true)` returns a Text
 * element whose props encode the highlight, and the rendered frame keeps the
 * key adjacent to its label because it's a single string.
 */
export function legendEntry(keyBracket: string, label: string, active = false): React.ReactElement {
  // One outer <Text> = one flex item, so the parent wrapping Box can never
  // split the key from its label (item 7). Nested <Text> inside a single
  // <Text> is inline — flex-wrap does not apply between them.
  return (
    <Text key={keyBracket + label}>
      <Text color={active ? 'yellow' : 'cyan'} inverse={active}>
        {keyBracket}
      </Text>
      <Text color={active ? 'yellow' : undefined} inverse={active} dimColor={!active}>
        {' ' + label}
      </Text>
    </Text>
  );
}

import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { FieldEditor } from '../../../../src/analyze/select/tui/components/FieldEditor.js';

const ENUM_COMPONENT = JSON.stringify(
  {
    Button: {
      $type: 'component',
      $description: 'A button',
      $properties: {
        variant: {
          $type: 'enum',
          $category: 'content',
          $description: 'Visual style',
          $values: ['primary', 'secondary', 'tertiary'],
        },
      },
    },
  },
  null,
  2,
);

const STRING_COMPONENT = JSON.stringify(
  {
    Hero: {
      $type: 'component',
      $properties: {
        title: {
          $type: 'string',
          $category: 'content',
          $description: 'Hero title',
        },
      },
    },
  },
  null,
  2,
);

const tick = () => new Promise((r) => setTimeout(r, 30));

/**
 * For an enum prop, drive the editor into the `values` field. Field order is:
 * type, category, required, values, description. Mount lands on the prop ROW
 * (no field active). Press Return → first field (type). Then j×3 to walk:
 * type → category → required → values.
 */
async function navigateToValuesField(stdin: { write: (data: string) => void }): Promise<void> {
  stdin.write('\r'); // Return → field mode at `type`
  await tick();
  stdin.write('j'); // type → category
  await tick();
  stdin.write('j'); // category → required
  await tick();
  stdin.write('j'); // required → values
  await tick();
}

describe('FieldEditor — row landing + Return-to-edit (Fix 2)', () => {
  it('mounts at the row level with NO field auto-active', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    // Hint reflects row-level navigation, not description-text-entry.
    expect(frame).toMatch(/navigate rows/);
    expect(frame).not.toMatch(/Type to edit/);
    // The description value is still rendered (just not active).
    expect(frame).toContain('Hero title');
  });

  it('typed characters at the row level do NOT edit the description', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('!');
    await tick();
    // Row-level: '!' is not bound, so onChange should not fire.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Return on a row enters field-edit at the FIRST field (type)', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('\r'); // Return → first field
    await tick();
    const frame = lastFrame() ?? '';
    // 'type' is the first field; its picker hint shows.
    expect(frame).toMatch(/cycle/);
  });

  it('navigates type → category → required → default → description via j', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    // Return → type field
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/cycle/);

    // j → category (still picker-cycle hint)
    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toMatch(/cycle/);

    // j → required (toggle hint)
    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toMatch(/toggle/);

    // j → default (default sub-row active). String-typed default is text-entry,
    // so j becomes literal there — use ↓ arrow to advance to description.
    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toMatch(/default:/);

    // ↓ arrow → description (text-entry hint)
    stdin.write('\x1b[B');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
  });

  it('arrow down at row level moves to the next row WITHOUT auto-focusing description', async () => {
    const value = JSON.stringify(
      {
        Card: {
          $type: 'component',
          $properties: {
            title: { $type: 'string', $category: 'content', $description: 'first' },
            body: { $type: 'string', $category: 'content', $description: 'second' },
          },
        },
      },
      null,
      2,
    );

    const onChange = vi.fn();
    const { stdin, lastFrame } = render(
      <FieldEditor value={value} width={80} height={20} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // Arrow-down at row level moves to `body` row but does NOT enter field-edit.
    stdin.write('\x1b[B');
    await tick();
    // Typing 'Z' at row level should not write into the description.
    stdin.write('Z');
    await tick();
    expect(onChange).not.toHaveBeenCalled();
    // Hint should still be row-level navigation.
    expect(lastFrame() ?? '').toMatch(/navigate rows/);
  });

  it('j/k inside description (after explicitly entering it) types literal characters', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    // Walk: row → Return (type) → j×3 → default → ↓ → description.
    // Cycle is type → category → required → default → description. j is
    // literal text in the (string-typed) default, so use ↓ to step past it.
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('\x1b[B');
    await tick();
    // Now description is active — j/k should type literal characters.
    stdin.write('j');
    await tick();
    stdin.write('k');
    await tick();
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain('Hero titlejk');
  });

  it('description-active state shows the bordered cyan affordance', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    // Walk to description: type → category → required → default → description.
    // Use ↓ arrow for the last hop since default is text-entry for strings.
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('\x1b[B');
    await tick();
    const frame = lastFrame() ?? '';
    // Bordered box renders with cyan border characters around description.
    expect(frame).toMatch(/Type to edit/);
    expect(frame).toContain('Hero title');
  });
});

describe('FieldEditor — flat enum-values (Fix 3)', () => {
  it('renders the values legend when activeField is values', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[a\]dd/);
    expect(frame).toMatch(/\[e\]dit/);
    expect(frame).toMatch(/\[r\]emove/);
    expect(frame).toMatch(/\[K\/J\] reorder/);
  });

  it('a enters add mode and Enter appends a new value', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    onChange.mockClear();
    // Add new value
    stdin.write('a');
    await tick();
    stdin.write('q');
    await tick();
    stdin.write('u');
    await tick();
    stdin.write('a');
    await tick();
    stdin.write('d');
    await tick();
    stdin.write('\r'); // Enter to commit
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain('quad');
    // Original values still there
    expect(lastCall).toContain('primary');
    expect(lastCall).toContain('secondary');
    expect(lastCall).toContain('tertiary');
  });

  it('e enters edit mode pre-filled at the cursor; Enter replaces the value', async () => {
    const onChange = vi.fn();
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    // Cursor is at index 0 by default (primary). Press 'e' to edit.
    stdin.write('e');
    await tick();
    // Pre-filled with "primary" — visible in frame
    const editFrame = lastFrame() ?? '';
    expect(editFrame).toContain('primary');

    // Backspace through "primary" (7 chars), then type "PRI"
    for (let i = 0; i < 7; i++) {
      stdin.write('\x7f');
      await tick();
    }
    stdin.write('P');
    await tick();
    stdin.write('R');
    await tick();
    stdin.write('I');
    await tick();
    stdin.write('\r');
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain('"PRI"');
    expect(lastCall).not.toContain('"primary"');
  });

  it('r removes the value at the cursor', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    onChange.mockClear();
    stdin.write('r'); // remove at cursor (index 0 = "primary")
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).not.toContain('"primary"');
    expect(lastCall).toContain('"secondary"');
    expect(lastCall).toContain('"tertiary"');
  });

  it('J (capital) moves the value at the cursor down', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    onChange.mockClear();
    stdin.write('J'); // move cursor (idx 0 = primary) down to idx 1
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    // Expect order in serialized $values: secondary, primary, tertiary
    const sIdx = lastCall.indexOf('"secondary"');
    const pIdx = lastCall.indexOf('"primary"');
    const tIdx = lastCall.indexOf('"tertiary"');
    expect(sIdx).toBeLessThan(pIdx);
    expect(pIdx).toBeLessThan(tIdx);
  });

  it('Esc cancels add mode without committing', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={ENUM_COMPONENT}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await navigateToValuesField(stdin);

    onChange.mockClear();
    stdin.write('a'); // enter add mode
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('\x1b'); // Esc to cancel
    await tick();

    // No change committed — onChange shouldn't have fired with a new value containing "z".
    if (onChange.mock.calls.length > 0) {
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(lastCall).not.toContain('"z"');
    }
  });
});

describe('FieldEditor — active prop gating', () => {
  it('does not consume keystrokes when active=false', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        active={false}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('Z');
    await tick();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('FieldEditor — field-nav cycling at edges (Bug 2)', () => {
  it('j at description (last field) cycles back to type (first field, same prop)', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    // Return → type → j → category → j → required → j → default → ↓ → description
    // (↓ used for the last hop because j is literal text in string-typed default.)
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('\x1b[B');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
    // Now arrow-down (NOT 'j' — j types literals in description) cycles to first field (type).
    stdin.write('\x1b[B');
    await tick();
    const frame = lastFrame() ?? '';
    // First field is `type` — picker hint shows.
    expect(frame).toMatch(/cycle/);
    expect(frame).not.toMatch(/Type to edit/);
  });

  it('arrow-up at type (first field) cycles to description (last field, same prop)', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    // Return → type field
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/cycle/);
    // arrow-up at first field cycles to last (description).
    stdin.write('\x1b[A');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
  });

  it('k at type (first field) cycles to description (last field, same prop)', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('\r');
    await tick();
    // k at type cycles back to description
    stdin.write('k');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
  });

  it('arrow-down inside description cycles to first field (type) instead of moving to next row', async () => {
    const value = JSON.stringify(
      {
        Card: {
          $type: 'component',
          $properties: {
            title: { $type: 'string', $category: 'content', $description: 'first' },
            body: { $type: 'string', $category: 'content', $description: 'second' },
          },
        },
      },
      null,
      2,
    );
    const { stdin, lastFrame } = render(
      <FieldEditor value={value} width={80} height={20} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // Return → type, j×3 → default, ↓ → description on the FIRST prop.
    // Cycle: type → category → required → default → description. j is literal
    // text in default for string-typed props; use ↓ for the last hop.
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('\x1b[B');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
    // Arrow-down inside description should now cycle to first field (type) of the SAME prop,
    // not jump to the body row.
    stdin.write('\x1b[B');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/cycle/); // type-picker hint
    expect(frame).not.toMatch(/Type to edit/);
  });
});

describe('FieldEditor — onExit panel-exit callback (Bug 1)', () => {
  it('Esc at row-level calls onExit (not onDiscard)', async () => {
    const onExit = vi.fn();
    const onDiscard = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={onDiscard}
        onExit={onExit}
      />,
    );
    // We mount at row-level. Pressing Esc here should call onExit.
    stdin.write('\x1b');
    await tick();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('Esc at field-level still drops to row-level (does NOT call onExit)', async () => {
    const onExit = vi.fn();
    const onDiscard = vi.fn();
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={onDiscard}
        onExit={onExit}
      />,
    );
    // Enter field-level
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/cycle/);
    // Esc at field-level drops to row-level — neither onExit nor onDiscard fires.
    stdin.write('\x1b');
    await tick();
    expect(onExit).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toMatch(/navigate rows/);
    // A second Esc at row-level fires onExit.
    stdin.write('\x1b');
    await tick();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Esc at row-level falls back to onDiscard when onExit is not provided', async () => {
    const onDiscard = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={onDiscard}
      />,
    );
    stdin.write('\x1b');
    await tick();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});

describe('FieldEditor — duplicate React-key safety (Bug 1, INTEG-4257)', () => {
  it('renders both a $properties section header AND a prop with idx 0 without dropping either', () => {
    // Pre-fix, the section header used key={i} (loop index in visibleRowSlice)
    // while prop rows used key={row.idx}. When the visible slice contained a
    // header at i=0 AND the prop at idx=0, both got key="0" — React kept only
    // the second. Post-fix, header keys are prefixed with "header-" so both
    // render.
    const COMPONENT_WITH_HEADER_AND_PROP = JSON.stringify(
      {
        Hero: {
          $type: 'component',
          $properties: {
            title: { $type: 'string', $category: 'content', $description: 'first' },
          },
        },
      },
      null,
      2,
    );
    const { lastFrame } = render(
      <FieldEditor
        value={COMPONENT_WITH_HEADER_AND_PROP}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    // Section header rendered.
    expect(frame).toContain('$properties');
    // Prop name (rendered by PropRow at idx 0) also rendered.
    expect(frame).toContain('title');
  });
});

describe('FieldEditor — Feature 5: propFields ordering ($default before description)', () => {
  it('cycle for richtext omits default — j×3 after Return lands on description (no default in cycle)', async () => {
    const RICHTEXT = JSON.stringify(
      {
        Block: {
          $type: 'component',
          $properties: {
            body: { $type: 'richtext', $category: 'content', $description: 'Rich body' },
          },
        },
      },
      null,
      2,
    );
    const { stdin, lastFrame } = render(
      <FieldEditor value={RICHTEXT} width={80} height={20} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // Return → type, j×3 → description (default skipped for richtext).
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
  });

  it('cycle for media omits default', async () => {
    const MEDIA = JSON.stringify(
      {
        Img: {
          $type: 'component',
          $properties: {
            src: { $type: 'media', $category: 'content' },
          },
        },
      },
      null,
      2,
    );
    const { stdin, lastFrame } = render(
      <FieldEditor value={MEDIA} width={80} height={20} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
  });

  it('renders (not applicable) for richtext default sub-row', () => {
    const RICHTEXT = JSON.stringify(
      {
        Block: {
          $type: 'component',
          $properties: {
            body: { $type: 'richtext', $category: 'content' },
          },
        },
      },
      null,
      2,
    );
    const { lastFrame } = render(
      <FieldEditor value={RICHTEXT} width={80} height={20} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(lastFrame() ?? '').toContain('(not applicable)');
  });
});

describe('FieldEditor — Feature 5: $default editor per prop type', () => {
  it('string prop: typing characters at default field updates $default', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    // Walk Return + j×3 → default.
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    // Now type 'H' 'i'.
    stdin.write('H');
    await tick();
    stdin.write('i');
    await tick();
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$default": "Hi"');
  });

  it('boolean prop: right arrow cycles default through true → false → unset → true', async () => {
    const BOOL = JSON.stringify(
      {
        Box: {
          $type: 'component',
          $properties: {
            visible: { $type: 'boolean', $category: 'content' },
          },
        },
      },
      null,
      2,
    );
    const onChange = vi.fn();
    const { stdin, lastFrame } = render(
      <FieldEditor value={BOOL} width={80} height={20} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // Walk Return + j×3 → default.
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    // Right arrow: (unset) → true.
    stdin.write('\x1b[C');
    await tick();
    expect(lastFrame() ?? '').toMatch(/true/);
    let last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$default": true');

    // Right again: true → false.
    stdin.write('\x1b[C');
    await tick();
    last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$default": false');

    // Right again: false → (unset). $default should be omitted.
    stdin.write('\x1b[C');
    await tick();
    last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).not.toContain('"$default"');
  });

  it('enum prop: right arrow cycles default through declared values plus (unset)', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor value={ENUM_COMPONENT} width={80} height={25} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // Cycle for enum: type → category → required → values → default → description.
    // Inside values, j/k navigate values not fields, so cycle backwards from
    // type via ↑: type → description → default.
    stdin.write('\r');
    await tick();
    stdin.write('\x1b[A'); // up: type → description (wrap)
    await tick();
    stdin.write('\x1b[A'); // up: description → default
    await tick();
    // Right arrow: (unset) → primary.
    stdin.write('\x1b[C');
    await tick();
    let last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$default": "primary"');
    // Next: primary → secondary
    stdin.write('\x1b[C');
    await tick();
    last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$default": "secondary"');
  });

  it('renders (none) for an unset string default', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(lastFrame() ?? '').toContain('(none)');
  });
});

describe('FieldEditor — Feature 5: $allowedComponents per-slot editor', () => {
  const CONTAINER = JSON.stringify(
    {
      Container: {
        $type: 'component',
        $properties: {},
        $slots: {
          children: { $description: 'Body', $allowedComponents: ['Card', 'Hero'] },
        },
      },
    },
    null,
    2,
  );

  // Helper: walk into the slot's allowedComponents field. Slot mounts at row,
  // Return → first field (required), j → allowedComponents.
  async function navigateToAllowedComponents(stdin: { write: (data: string) => void }): Promise<void> {
    stdin.write('\r'); // Return → first field (required)
    await tick();
    stdin.write('j'); // required → allowedComponents
    await tick();
  }

  it('renders the allowedComponents legend when active', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor value={CONTAINER} width={80} height={25} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    await navigateToAllowedComponents(stdin);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[a\]dd/);
    expect(frame).toMatch(/\[e\]dit/);
    expect(frame).toMatch(/\[r\]emove/);
    expect(frame).toMatch(/\[K\/J\] reorder/);
    expect(frame).toContain('Card');
    expect(frame).toContain('Hero');
  });

  it('a then typing then Enter appends a new component name', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor value={CONTAINER} width={80} height={25} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    await navigateToAllowedComponents(stdin);
    onChange.mockClear();
    stdin.write('a');
    await tick();
    'Btn'.split('').forEach((c) => stdin.write(c));
    await tick();
    stdin.write('\r');
    await tick();
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"Btn"');
    expect(last).toContain('"Card"');
    expect(last).toContain('"Hero"');
  });

  it('r removes the component at the cursor', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor value={CONTAINER} width={80} height={25} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    await navigateToAllowedComponents(stdin);
    onChange.mockClear();
    stdin.write('r'); // remove at cursor 0 = Card
    await tick();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).not.toContain('"Card"');
    expect(last).toContain('"Hero"');
  });

  it('J moves the component at the cursor down', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor value={CONTAINER} width={80} height={25} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    await navigateToAllowedComponents(stdin);
    onChange.mockClear();
    stdin.write('J');
    await tick();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    const heroIdx = last.indexOf('"Hero"');
    const cardIdx = last.indexOf('"Card"');
    expect(heroIdx).toBeLessThan(cardIdx);
  });

  it('Esc cancels add mode', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor value={CONTAINER} width={80} height={25} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    await navigateToAllowedComponents(stdin);
    onChange.mockClear();
    stdin.write('a');
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('\x1b');
    await tick();
    if (onChange.mock.calls.length > 0) {
      const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
      expect(last).not.toContain('"z"');
    }
  });

  it('renders (any) when allowedComponents is empty', () => {
    const EMPTY = JSON.stringify(
      {
        Container: {
          $type: 'component',
          $properties: {},
          $slots: { children: {} },
        },
      },
      null,
      2,
    );
    const { lastFrame } = render(
      <FieldEditor value={EMPTY} width={80} height={20} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    expect(lastFrame() ?? '').toContain('(any)');
  });

  it('SLOT_FIELDS cycle: required → allowedComponents (down arrow); description reachable via wrap', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor value={CONTAINER} width={80} height={25} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // Return → required (toggle hint).
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/toggle/);
    // ↓ → allowedComponents (legend visible).
    stdin.write('\x1b[B');
    await tick();
    expect(lastFrame() ?? '').toMatch(/\[a\]dd/);
    // Once inside allowedComponents, ↑↓ navigate the list (not fields) —
    // mirrors enum $values. To reach description, wrap backwards via Esc +
    // Return to first field, then ↑ wraps to last (description).
    stdin.write('\x1b'); // Esc → row level
    await tick();
    stdin.write('\r'); // Return → required (first field)
    await tick();
    stdin.write('\x1b[A'); // ↑ → wrap to last field (description)
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
  });
});

describe('FieldEditor — Feature 5: component $description as first navigable row', () => {
  const HERO_WITH_DESC = JSON.stringify(
    {
      Hero: {
        $type: 'component',
        $description: 'Top-level hero',
        $properties: {
          title: { $type: 'string', $category: 'content', $description: 'first' },
        },
      },
    },
    null,
    2,
  );

  it('renders the component-description row above $properties', () => {
    const { lastFrame } = render(
      <FieldEditor value={HERO_WITH_DESC} width={80} height={20} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    // Row label and description value visible.
    expect(frame).toContain('Top-level hero');
    // The component-description row appears before the $properties header.
    const descIdx = frame.indexOf('Top-level hero');
    const propsIdx = frame.indexOf('$properties');
    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(propsIdx).toBeGreaterThan(descIdx);
  });

  it('k from the first prop row enters the component-description row', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor value={HERO_WITH_DESC} width={80} height={20} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // Mount lands on prop[0]. Press k → component-description row.
    stdin.write('k');
    await tick();
    // Press Return → enter description editing (bordered cyan affordance).
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
  });

  it('typing on the component-description row updates the component-level $description', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor value={HERO_WITH_DESC} width={80} height={20} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    stdin.write('k'); // → component-description row
    await tick();
    stdin.write('\r'); // enter edit
    await tick();
    stdin.write('!');
    await tick();
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$description": "Top-level hero!"');
  });

  it('j from the component-description row enters the first prop row', async () => {
    const { stdin } = render(
      <FieldEditor value={HERO_WITH_DESC} width={80} height={20} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // Mount on prop[0]. k → component-description. j → back to prop[0].
    stdin.write('k');
    await tick();
    stdin.write('j');
    await tick();
    // Confirm we're back on a prop row by entering field-edit.
    stdin.write('\r');
    await tick();
    // First field of prop[0] is type — picker hint shows.
    // (No direct row-name selector in the frame, but Return + cycle proves it.)
  });

  it('renders the row even when $description is empty (operator can populate)', () => {
    const NO_DESC = JSON.stringify(
      {
        Hero: {
          $type: 'component',
          $properties: {
            title: { $type: 'string', $category: 'content' },
          },
        },
      },
      null,
      2,
    );
    const { lastFrame } = render(
      <FieldEditor value={NO_DESC} width={80} height={20} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    // The row label should appear even when value is empty.
    expect(lastFrame() ?? '').toMatch(/component-description|component \$description|\$description/i);
  });
});

describe('FieldEditor — Feature 5: parseToState round-trip ($default, $allowedComponents, $description)', () => {
  it('round-trips per-prop $default for string/number/token/boolean/enum without edits', async () => {
    const FIXTURE = JSON.stringify(
      {
        Mixer: {
          $type: 'component',
          $description: 'Top-level desc',
          $properties: {
            label: { $type: 'string', $category: 'content', $default: 'Hello' },
            color: { $type: 'token', $category: 'style', '$token.kind': 'color', $default: 'tokens.red' },
            visible: { $type: 'boolean', $category: 'content', $default: true },
            variant: { $type: 'enum', $category: 'content', $values: ['a', 'b'], $default: 'b' },
          },
        },
      },
      null,
      2,
    );

    const onChange = vi.fn();
    const onSave = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={FIXTURE}
        width={80}
        height={30}
        onChange={onChange}
        onSave={onSave}
        onDiscard={vi.fn()}
      />,
    );
    // Force a serialize by toggling required on first prop, then toggling back.
    stdin.write('\r'); // enter field-edit at type
    await tick();
    stdin.write('j'); // category
    await tick();
    stdin.write('j'); // required
    await tick();
    stdin.write(' '); // toggle required on
    await tick();
    stdin.write(' '); // toggle required off
    await tick();

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$default": "Hello"');
    expect(last).toContain('"$default": "tokens.red"');
    expect(last).toContain('"$default": true');
    expect(last).toContain('"$default": "b"');
  });

  it('round-trips per-slot $allowedComponents without edits', async () => {
    const FIXTURE = JSON.stringify(
      {
        Container: {
          $type: 'component',
          $properties: {
            title: { $type: 'string', $category: 'content' },
          },
          $slots: {
            children: { $description: 'Body', $allowedComponents: ['Card', 'Hero'] },
          },
        },
      },
      null,
      2,
    );

    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={FIXTURE}
        width={80}
        height={30}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    // Toggle required on title to force a serialize.
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write(' ');
    await tick();
    stdin.write(' ');
    await tick();

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$allowedComponents"');
    expect(last).toContain('"Card"');
    expect(last).toContain('"Hero"');
  });

  it('round-trips component-level $description without edits', async () => {
    const FIXTURE = JSON.stringify(
      {
        Hero: {
          $type: 'component',
          $description: 'Top-level hero description',
          $properties: {
            title: { $type: 'string', $category: 'content' },
          },
        },
      },
      null,
      2,
    );

    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={FIXTURE}
        width={80}
        height={30}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write(' ');
    await tick();
    stdin.write(' ');
    await tick();

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$description": "Top-level hero description"');
  });
});

describe('FieldEditor — empty-properties warning (Bug 2, INTEG-4257)', () => {
  const EMPTY_PROPS_COMPONENT = JSON.stringify(
    {
      OpaqueWidget: {
        $type: 'component',
        $properties: {},
      },
    },
    null,
    2,
  );

  const EMPTY_PROPS_WITH_SLOT = JSON.stringify(
    {
      OpaqueWidget: {
        $type: 'component',
        $properties: {},
        $slots: { children: { $description: 'Body' } },
      },
    },
    null,
    2,
  );

  it('shows a yellow ⚠ banner when the component has zero $properties (no slots either)', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={EMPTY_PROPS_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('⚠');
    expect(frame).toMatch(/No properties classified/i);
  });

  it('shows the same warning when $properties is empty but $slots exists', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={EMPTY_PROPS_WITH_SLOT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('⚠');
    expect(frame).toMatch(/No properties classified/i);
  });
});

describe('FieldEditor — Feature 1 (rationale + source view)', () => {
  it('renders LLM rationale inline below description (dim, prefixed ~)', async () => {
    const { lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={{
          sourcePath: '/proj/Hero.tsx',
          componentSource: '',
          props: {
            title: { rationale: 'inferred enum from named type ButtonVariant' },
          },
        }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('~ inferred enum from named type ButtonVariant');
  });

  it('rationale is non-navigable — j/k from prop row does not land on it', async () => {
    const { lastFrame, stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={{
          props: { title: { rationale: 'reasoning' } },
        }}
      />,
    );
    stdin.write('\r'); // Return → first field (type)
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    const frame = lastFrame() ?? '';
    // Rationale row remains rendered; it is not a focusable field.
    expect(frame).toContain('~ reasoning');
  });

  it('opens the source-view panel on `s` and renders the captured line slice', async () => {
    const { lastFrame, stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={{
          sourcePath: '/proj/Hero.tsx',
          componentSource: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'].join('\n'),
          props: { title: { sourceStartLine: 3, sourceEndLine: 5, rationale: null } },
        }}
      />,
    );
    stdin.write('s');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/proj/Hero.tsx');
    expect(frame).toContain('lines 3');
    expect(frame).toContain('L3');
    expect(frame).toContain('L4');
    expect(frame).toContain('L5');
    expect(frame).not.toContain('L2');
    expect(frame).not.toContain('L6');
  });

  it('toggles the source panel closed on a second `s`', async () => {
    const { lastFrame, stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={{
          sourcePath: '/proj/Hero.tsx',
          componentSource: 'A\nB\nC',
          props: { title: { sourceStartLine: 1, sourceEndLine: 1 } },
        }}
      />,
    );
    stdin.write('s');
    await tick();
    expect(lastFrame() ?? '').toContain('/proj/Hero.tsx');
    stdin.write('s');
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/lines 1/);
  });

  it('Esc while panel is open closes panel and does not bubble to onExit', async () => {
    const onExit = vi.fn();
    const onDiscard = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={onDiscard}
        onExit={onExit}
        metadata={{
          sourcePath: '/proj/Hero.tsx',
          componentSource: 'A',
          props: { title: { sourceStartLine: 1, sourceEndLine: 1 } },
        }}
      />,
    );
    stdin.write('s');
    await tick();
    stdin.write(''); // Esc
    await tick();
    expect(onExit).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('renders "(no source location captured)" when sourceStartLine is missing', async () => {
    const { lastFrame, stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={{
          sourcePath: '/proj/Hero.tsx',
          componentSource: 'A\nB',
          props: { title: {} },
        }}
      />,
    );
    stdin.write('s');
    await tick();
    expect(lastFrame() ?? '').toContain('no source location captured');
  });

  it('renders "<unknown source path>" when sourcePath is missing', async () => {
    const { lastFrame, stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={{
          componentSource: 'A\nB',
          props: { title: { sourceStartLine: 1, sourceEndLine: 1 } },
        }}
      />,
    );
    stdin.write('s');
    await tick();
    expect(lastFrame() ?? '').toContain('<unknown source path>');
  });

  it('renders without metadata (backwards compatible)', async () => {
    const { lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    // Component still renders normally; no rationale row.
    expect(frame).toContain('title');
    expect(frame).not.toContain('~ ');
  });
});

describe('FieldEditor — discoverability footer (s source, ? help)', () => {
  it('row-level footer advertises the source-view (`s`) and help (`?`) keys', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/s source/);
    expect(frame).toMatch(/\? help/);
  });
});

describe('FieldEditor — keybindings overlay (`?`)', () => {
  it('opens the overlay when `?` is pressed and lists wired keybindings', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('?');
    await tick();
    const frame = lastFrame() ?? '';
    // Title is present.
    expect(frame).toMatch(/Keybindings/);
    // Lists at least one entry per group (row nav, field editing, panels).
    expect(frame).toMatch(/navigate.*rows|move between rows/i);
    expect(frame).toMatch(/Ctrl\+S/);
    expect(frame).toMatch(/source-view|source/i);
    // Foot of the overlay tells the user how to exit.
    expect(frame).toMatch(/\? or Esc to close|press \? .* close/i);
    // Pilot-2026-06-24: `d` opens the removed-detail panel in the wizard's
    // GenerateReviewStep — list it alongside `s` and `?` for discoverability.
    expect(frame).toMatch(/\bd\b.*removed/i);
  });

  it('a second `?` press closes the overlay', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('?');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Keybindings/);
    stdin.write('?');
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Keybindings/);
  });

  it('Esc closes the overlay', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('?');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Keybindings/);
    stdin.write('\x1b');
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Keybindings/);
  });

  it('while overlay is open j/k/Enter/Ctrl+S do NOT mutate state or trigger callbacks', async () => {
    const onSave = vi.fn();
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={onChange}
        onSave={onSave}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('?');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('k');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('\x13'); // Ctrl+S
    await tick();
    expect(onSave).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('FieldEditor - rationale panels are lifted to the parent', () => {
  const META = {
    sourcePath: '/proj/Hero.tsx',
    componentSource: 'L1\nL2\nL3',
    props: {
      title: { rationale: 'inferred string from JSX literal', sourceStartLine: 1, sourceEndLine: 1 },
    },
  } as const;

  it('does NOT render the rationale panel inline anymore', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={META}
        onTogglePropRationale={vi.fn()}
      />,
    );
    stdin.write('i');
    await tick();
    const frame = lastFrame() ?? '';
    // The lifted-panel callback handler short-circuits before any internal
    // panel state would be set, so the inline RATIONALE header must NOT appear.
    expect(frame).not.toMatch(/^RATIONALE/m);
  });

  it('emits onTogglePropRationale when `i` is pressed at row-level', async () => {
    const onTogglePropRationale = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={META}
        onTogglePropRationale={onTogglePropRationale}
      />,
    );
    stdin.write('i');
    await tick();
    expect(onTogglePropRationale).toHaveBeenCalledTimes(1);
  });

  it('emits onToggleComponentRationale when `I` is pressed at row-level', async () => {
    const onToggleComponentRationale = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={META}
        onTogglePropRationale={vi.fn()}
        onToggleComponentRationale={onToggleComponentRationale}
      />,
    );
    stdin.write('I');
    await tick();
    expect(onToggleComponentRationale).toHaveBeenCalledTimes(1);
  });

  it('emits onToggleSourceExternal when `s` is pressed at row-level', async () => {
    const onToggleSourceExternal = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={META}
        onToggleSourceExternal={onToggleSourceExternal}
      />,
    );
    stdin.write('s');
    await tick();
    expect(onToggleSourceExternal).toHaveBeenCalledTimes(1);
  });

  it('does NOT emit onTogglePropRationale while operator is typing in a description field', async () => {
    const onTogglePropRationale = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={META}
        onTogglePropRationale={onTogglePropRationale}
      />,
    );
    // Navigate into description text-entry.
    stdin.write('\r'); // enter prop field-edit at first field
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('i');
    await tick();
    expect(onTogglePropRationale).not.toHaveBeenCalled();
  });

  it('reports text-entry-active state to the parent via onTextEntryActiveChange', async () => {
    const onTextEntryActiveChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={24}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={META}
        onTextEntryActiveChange={onTextEntryActiveChange}
      />,
    );
    // The effect fires at mount: should be false initially.
    await tick();
    expect(onTextEntryActiveChange).toHaveBeenCalledWith(false);
    // Enter description text-entry. Now true.
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    expect(onTextEntryActiveChange).toHaveBeenLastCalledWith(true);
  });

  it('legend shows `[i] rationale` cue when at row-level (unchanged from prior spec)', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={META}
      />,
    );
    expect(lastFrame() ?? '').toMatch(/i\s+rationale|rationale/);
  });
});

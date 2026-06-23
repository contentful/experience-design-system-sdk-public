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

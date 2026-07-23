import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import {
  FieldEditor,
  computeAllowedComponentCandidates,
  computeAllowedComponentReplacementCandidates,
  simulateGraphWithCandidate,
  simulateGraphWithReplacement,
  introducesNewCycle,
} from '../../../../src/analyze/select/tui/components/FieldEditor.js';
import { findSlotCycles } from '../../../../src/analyze/cycle-detection.js';

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

async function navigateToValuesField(stdin: { write: (data: string) => void }): Promise<void> {
  stdin.write('\r');
  await tick();
  stdin.write('j');
  await tick();
  stdin.write('j');
  await tick();
  stdin.write('j');
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
    expect(frame).toMatch(/navigate rows/);
    expect(frame).not.toMatch(/Type to edit/);
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
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
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
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/cycle/);

    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toMatch(/cycle/);

    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toMatch(/toggle/);

    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toMatch(/default:/);

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
    stdin.write('\x1b[B');
    await tick();
    stdin.write('Z');
    await tick();
    expect(onChange).not.toHaveBeenCalled();
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
    stdin.write('\r');
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(lastCall).toContain('quad');
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

    stdin.write('e');
    await tick();
    const editFrame = lastFrame() ?? '';
    expect(editFrame).toContain('primary');

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
    stdin.write('r');
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
    stdin.write('J');
    await tick();

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
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
    stdin.write('a');
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('\x1b');
    await tick();

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
    stdin.write('\x1b[B');
    await tick();
    const frame = lastFrame() ?? '';
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
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/cycle/);
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
    stdin.write('\x1b[B');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/cycle/);
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
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/cycle/);
    stdin.write('\x1b');
    await tick();
    expect(onExit).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toMatch(/navigate rows/);
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
    expect(frame).toContain('PROPERTIES');
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
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
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
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('\x1b[C');
    await tick();
    expect(lastFrame() ?? '').toMatch(/true/);
    let last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$default": true');

    stdin.write('\x1b[C');
    await tick();
    last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$default": false');

    stdin.write('\x1b[C');
    await tick();
    last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).not.toContain('"$default"');
  });

  it('enum prop: right arrow cycles default through declared values plus (unset)', async () => {
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
    stdin.write('\r');
    await tick();
    stdin.write('\x1b[A');
    await tick();
    stdin.write('\x1b[A');
    await tick();
    stdin.write('\x1b[C');
    await tick();
    let last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$default": "primary"');
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

  async function navigateToAllowedComponents(stdin: { write: (data: string) => void }): Promise<void> {
    stdin.write('\r');
    await tick();
    stdin.write('j');
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
    stdin.write('r');
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

  it('renders the allowedComponents summary on unselected slot rows (INTEG-4401 Fix 5)', () => {
    const TWO_SLOTS = JSON.stringify(
      {
        Container: {
          $type: 'component',
          $properties: {},
          $slots: {
            header: { $allowedComponents: ['Heading'] },
            body: { $allowedComponents: [] },
          },
        },
      },
      null,
      2,
    );
    const { lastFrame } = render(
      <FieldEditor value={TWO_SLOTS} width={80} height={25} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Heading');
    expect(frame).toContain('(any)');
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
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/toggle/);
    stdin.write('\x1b[B');
    await tick();
    expect(lastFrame() ?? '').toMatch(/\[a\]dd/);
    stdin.write('\x1b');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('\x1b[A');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
  });

  it('down-arrow escapes allowedComponents to description at the list boundary, then typing edits it', async () => {
    const onChange = vi.fn();
    const { stdin, lastFrame } = render(
      <FieldEditor value={CONTAINER} width={80} height={25} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    stdin.write('\r'); // enter fields on the slot → 'required'
    await tick();
    stdin.write('\x1b[B'); // down → 'allowedComponents' (values-nav; cursor lands at top)
    await tick();
    expect(lastFrame() ?? '').toMatch(/\[a\]dd/);
    // CONTAINER's slot has 2 allowedComponents (Card, Hero): first down moves the
    // value cursor to the last entry, second down escapes the field → 'description'.
    stdin.write('\x1b[B');
    await tick();
    stdin.write('\x1b[B');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
    stdin.write('X'); // typing edits the slot description
    await tick();
    const last = onChange.mock.calls.at(-1)?.[0] ?? '';
    expect(last).toContain('BodyX');
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
      <FieldEditor
        value={HERO_WITH_DESC}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Top-level hero');
    const descIdx = frame.indexOf('Top-level hero');
    const propsIdx = frame.indexOf('PROPERTIES');
    expect(descIdx).toBeGreaterThanOrEqual(0);
    expect(propsIdx).toBeGreaterThan(descIdx);
  });

  it('k from the first prop row enters the component-description row', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={HERO_WITH_DESC}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('k');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/Type to edit/);
  });

  it('typing on the component-description row updates the component-level $description', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={HERO_WITH_DESC}
        width={80}
        height={20}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('k');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('!');
    await tick();
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"$description": "Top-level hero!"');
  });

  it('j from the component-description row enters the first prop row', async () => {
    const { stdin } = render(
      <FieldEditor
        value={HERO_WITH_DESC}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    stdin.write('k');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('\r');
    await tick();
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
      <FieldEditor value={FIXTURE} width={80} height={30} onChange={onChange} onSave={onSave} onDiscard={vi.fn()} />,
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
      <FieldEditor value={FIXTURE} width={80} height={30} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
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
      <FieldEditor value={FIXTURE} width={80} height={30} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
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

  it('does NOT warn when $properties is empty but $slots exists — slots are a valid authorable surface', () => {
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
    expect(frame).not.toMatch(/No properties classified/i);
    expect(frame).not.toMatch(/no fields/i);
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
    stdin.write('\r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    const frame = lastFrame() ?? '';
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
    stdin.write('');
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
    expect(frame).toMatch(/Keybindings/);
    expect(frame).toMatch(/navigate.*rows|move between rows/i);
    expect(frame).toMatch(/Ctrl\+S/);
    expect(frame).toMatch(/source-view|source/i);
    expect(frame).toMatch(/\? or Esc to close|press \? .* close/i);
    expect(frame).not.toMatch(/\bd\b.*removed/i);
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
    stdin.write('\x13');
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
    await tick();
    expect(onTextEntryActiveChange).toHaveBeenCalledWith(false);
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

describe('FieldEditor - legend documents i and I keys', () => {
  const META = {
    sourcePath: '/proj/Hero.tsx',
    componentSource: 'L1',
    props: {
      title: { rationale: 'why title', sourceStartLine: 1, sourceEndLine: 1 },
    },
  } as const;

  it('legend mentions both i (prop) and I (component) rationale keys', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={120}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={META}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/i\s+prop rationale|i prop rationale/);
    expect(out).toMatch(/I\s+component rationale|I component rationale/);
  });

  it('help overlay documents I for component rationale and clarifies i for prop rationale', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={120}
        height={28}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        metadata={META}
      />,
    );
    stdin.write('?');
    await tick();
    const out = lastFrame() ?? '';
    expect(out).toContain('toggle prop rationale panel');
    expect(out).toContain('toggle component rationale panel');
  });
});

describe('FieldEditor — INTEG-4401: computeAllowedComponentCandidates (unit)', () => {
  it('excludes candidates whose addition would create a new cycle (Card.header ← X, X.body ← Card ⇒ Card→X)', () => {
    const graph = [
      { name: 'Card', slots: [{ name: 'header', allowedComponents: [] }] },
      { name: 'X', slots: [{ name: 'body', allowedComponents: ['Card'] }] },
      { name: 'Safe', slots: [] },
    ];
    const currentSlots = [{ name: 'header', allowedComponents: [] as string[] }];
    const cands = computeAllowedComponentCandidates(graph, 'Card', currentSlots, 'header');
    expect(cands).not.toContain('Card');
    expect(cands).not.toContain('X');
    expect(cands).toContain('Safe');
  });

  it('excludes names already present in the slot', () => {
    const graph = [
      { name: 'Card', slots: [{ name: 'header', allowedComponents: ['A'] }] },
      { name: 'A', slots: [] },
      { name: 'B', slots: [] },
    ];
    const currentSlots = [{ name: 'header', allowedComponents: ['A'] }];
    const cands = computeAllowedComponentCandidates(graph, 'Card', currentSlots, 'header');
    expect(cands).not.toContain('A');
    expect(cands).toContain('B');
  });

  it('returns the empty list when every candidate would cycle', () => {
    const graph = [
      { name: 'A', slots: [{ name: 's', allowedComponents: [] }] },
      { name: 'B', slots: [{ name: 't', allowedComponents: ['A'] }] },
    ];
    const currentSlots = [{ name: 's', allowedComponents: [] as string[] }];
    const cands = computeAllowedComponentCandidates(graph, 'A', currentSlots, 's');
    expect(cands).toEqual([]);
  });

  it('reflects pending unsaved edits — self entry is replaced by currentSlots', () => {
    const graph = [
      { name: 'Card', slots: [{ name: 'header', allowedComponents: [] }] },
      { name: 'B', slots: [] },
      { name: 'X', slots: [] },
    ];
    const pending = [
      { name: 'header', allowedComponents: [] as string[] },
      { name: 'other', allowedComponents: ['B'] },
    ];
    const cands = computeAllowedComponentCandidates(graph, 'Card', pending, 'header');
    expect(cands).toContain('B');
    expect(cands).toContain('X');
  });

  it('simulateGraphWithCandidate + findSlotCycles surfaces the new elementary cycle', () => {
    const graph = [
      { name: 'Card', slots: [{ name: 'header', allowedComponents: [] }] },
      { name: 'X', slots: [{ name: 'body', allowedComponents: ['Card'] }] },
    ];
    const currentSlots = [{ name: 'header', allowedComponents: [] as string[] }];
    const before = findSlotCycles(simulateGraphWithCandidate(graph, 'Card', currentSlots, '', ''));
    const after = findSlotCycles(simulateGraphWithCandidate(graph, 'Card', currentSlots, 'header', 'X'));
    expect(before.length).toBe(0);
    expect(after.length).toBeGreaterThan(0);
    expect(introducesNewCycle(before, after)).toBe(true);
  });

  it('sorts candidates alphabetically for a stable picker order', () => {
    const graph = [
      { name: 'Root', slots: [{ name: 's', allowedComponents: [] }] },
      { name: 'Zed', slots: [] },
      { name: 'Alpha', slots: [] },
      { name: 'Mango', slots: [] },
    ];
    const currentSlots = [{ name: 's', allowedComponents: [] as string[] }];
    const cands = computeAllowedComponentCandidates(graph, 'Root', currentSlots, 's');
    expect(cands).toEqual(['Alpha', 'Mango', 'Zed']);
  });
});

describe('FieldEditor — INTEG-4401: picker render + input (render)', () => {
  const CONTAINER = JSON.stringify(
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
  const PROJECT_GRAPH = [
    { name: 'Container', slots: [{ name: 'children', allowedComponents: [] }] },
    { name: 'Alpha', slots: [] },
    { name: 'Beta', slots: [] },
    { name: 'Bad', slots: [{ name: 'ref', allowedComponents: ['Container'] }] },
  ];

  async function navigateAndPressAdd(stdin: { write: (data: string) => void }): Promise<void> {
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('a');
    await new Promise((r) => setTimeout(r, 30));
  }

  it('renders the cycle-filtered candidate list; Bad is excluded', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={CONTAINER}
        width={80}
        height={25}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={PROJECT_GRAPH}
        currentComponentName="Container"
      />,
    );
    await navigateAndPressAdd(stdin);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('candidates (↑↓ cycle, Enter to add):');
    expect(frame).toContain('Alpha');
    expect(frame).toContain('Beta');
    expect(frame).not.toContain('Bad');
  });

  it('↓ moves the picker cursor and Enter commits the highlighted candidate', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={CONTAINER}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={PROJECT_GRAPH}
        currentComponentName="Container"
      />,
    );
    await navigateAndPressAdd(stdin);
    onChange.mockClear();
    stdin.write('\x1b[B');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"Beta"');
    expect(last).not.toContain('"Alpha"');
  });

  it('renders "no valid components" line when every candidate would cycle', async () => {
    const ALL_CYCLE = [
      { name: 'Container', slots: [{ name: 'children', allowedComponents: [] }] },
      { name: 'X', slots: [{ name: 'r', allowedComponents: ['Container'] }] },
      { name: 'Y', slots: [{ name: 'r', allowedComponents: ['Container'] }] },
    ];
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={CONTAINER}
        width={80}
        height={25}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={ALL_CYCLE}
        currentComponentName="Container"
      />,
    );
    await navigateAndPressAdd(stdin);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('no valid components to add');
  });

  it('free-text add of a cycle-forming name is rejected with an inline error', async () => {
    const onChange = vi.fn();
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={CONTAINER}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={PROJECT_GRAPH}
        currentComponentName="Container"
      />,
    );
    await navigateAndPressAdd(stdin);
    onChange.mockClear();
    'Bad'.split('').forEach((c) => stdin.write(c));
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    const anyBad = onChange.mock.calls.some((call) => typeof call[0] === 'string' && call[0].includes('"Bad"'));
    expect(anyBad).toBe(false);
    expect(lastFrame() ?? '').toMatch(/slot-dependency cycle/);
  });

  it('free-text add of the self-name is rejected with a self-loop error', async () => {
    const onChange = vi.fn();
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={CONTAINER}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={PROJECT_GRAPH}
        currentComponentName="Container"
      />,
    );
    await navigateAndPressAdd(stdin);
    onChange.mockClear();
    'Container'.split('').forEach((c) => stdin.write(c));
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    expect(lastFrame() ?? '').toMatch(/self-loop/);
    const anySelf = onChange.mock.calls.some(
      (call) => typeof call[0] === 'string' && call[0].includes('"$allowedComponents": [\n          "Container"'),
    );
    expect(anySelf).toBe(false);
  });

  it('regression: no picker rendered when projectSlotGraph is omitted (free-text-only)', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor value={CONTAINER} width={80} height={25} onChange={vi.fn()} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    await navigateAndPressAdd(stdin);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('candidates (↑↓');
    expect(frame).not.toContain('no valid components');
    expect(frame).toContain('+ ');
  });

  it('regression: free-text add of a non-cycling name still works when picker is active', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={CONTAINER}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={PROJECT_GRAPH}
        currentComponentName="Container"
      />,
    );
    await navigateAndPressAdd(stdin);
    onChange.mockClear();
    'NewComp'.split('').forEach((c) => stdin.write(c));
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string | undefined;
    expect(last).toContain('"NewComp"');
  });
});

describe('FieldEditor — INTEG-4401: computeAllowedComponentReplacementCandidates (unit)', () => {
  it('excludes self-name and other existing entries, keeps the entry at replaceIndex', () => {
    const graph = [
      { name: 'Card', slots: [{ name: 'header', allowedComponents: ['Heading', 'Button'] }] },
      { name: 'Heading', slots: [] },
      { name: 'Button', slots: [] },
      { name: 'Layout', slots: [] },
    ];
    const currentSlots = [{ name: 'header', allowedComponents: ['Heading', 'Button'] }];
    const cands = computeAllowedComponentReplacementCandidates(graph, 'Card', currentSlots, 'header', 0);
    expect(cands).not.toContain('Card');
    expect(cands).not.toContain('Button');
    expect(cands).toContain('Heading');
    expect(cands).toContain('Layout');
  });

  it('excludes cycle-forming candidates', () => {
    const graph = [
      { name: 'Card', slots: [{ name: 'header', allowedComponents: ['Heading'] }] },
      { name: 'Heading', slots: [] },
      { name: 'X', slots: [{ name: 'body', allowedComponents: ['Card'] }] },
    ];
    const currentSlots = [{ name: 'header', allowedComponents: ['Heading'] }];
    const cands = computeAllowedComponentReplacementCandidates(graph, 'Card', currentSlots, 'header', 0);
    expect(cands).toContain('Heading');
    expect(cands).not.toContain('X');
    expect(cands).not.toContain('Card');
  });

  it('sorts candidates alphabetically', () => {
    const graph = [
      { name: 'Root', slots: [{ name: 's', allowedComponents: ['Beta'] }] },
      { name: 'Alpha', slots: [] },
      { name: 'Beta', slots: [] },
      { name: 'Mango', slots: [] },
    ];
    const currentSlots = [{ name: 's', allowedComponents: ['Beta'] }];
    const cands = computeAllowedComponentReplacementCandidates(graph, 'Root', currentSlots, 's', 0);
    expect(cands).toEqual(['Alpha', 'Beta', 'Mango']);
  });

  it('simulateGraphWithReplacement changes only the target index', () => {
    const graph = [
      { name: 'Card', slots: [{ name: 'header', allowedComponents: ['A', 'B'] }] },
      { name: 'A', slots: [] },
      { name: 'B', slots: [] },
      { name: 'C', slots: [] },
    ];
    const currentSlots = [{ name: 'header', allowedComponents: ['A', 'B'] }];
    const simulated = simulateGraphWithReplacement(graph, 'Card', currentSlots, 'header', 1, 'C');
    const cardEntry = simulated.find((c) => c.name === 'Card')!;
    expect(cardEntry.slots[0]?.allowedComponents).toEqual(['A', 'C']);
  });

  it('returns [] when every candidate would introduce a cycle', () => {
    const graph = [
      { name: 'A', slots: [{ name: 's', allowedComponents: ['A_prev'] }] },
      { name: 'B', slots: [{ name: 't', allowedComponents: ['A'] }] },
      { name: 'A_prev', slots: [] },
    ];
    const currentSlots = [{ name: 's', allowedComponents: ['A_prev'] }];
    const cands = computeAllowedComponentReplacementCandidates(graph, 'A', currentSlots, 's', 0);
    expect(cands).toContain('A_prev');
    expect(cands).not.toContain('B');
    expect(cands).not.toContain('A');
  });
});

describe('FieldEditor — INTEG-4401: cycle existing $allowedComponents entries (render)', () => {
  const CARD = JSON.stringify(
    {
      Card: {
        $type: 'component',
        $properties: {},
        $slots: { header: { $allowedComponents: ['Heading'] } },
      },
    },
    null,
    2,
  );
  const PROJECT_GRAPH = [
    { name: 'Card', slots: [{ name: 'header', allowedComponents: ['Heading'] }] },
    { name: 'Heading', slots: [] },
    { name: 'Button', slots: [] },
    { name: 'Layout', slots: [] },
  ];

  async function navigateToAllowedComponentsRow(stdin: { write: (data: string) => void }): Promise<void> {
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('j');
    await new Promise((r) => setTimeout(r, 30));
  }

  it('→ replaces the entry at cursor with the next valid candidate', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={CARD}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={PROJECT_GRAPH}
        currentComponentName="Card"
      />,
    );
    await navigateToAllowedComponentsRow(stdin);
    onChange.mockClear();
    stdin.write('\x1b[C');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"Layout"');
    expect(last).not.toContain('"Heading"');
  });

  it('← replaces the entry at cursor with the previous valid candidate', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={CARD}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={PROJECT_GRAPH}
        currentComponentName="Card"
      />,
    );
    await navigateToAllowedComponentsRow(stdin);
    onChange.mockClear();
    stdin.write('\x1b[D');
    await new Promise((r) => setTimeout(r, 30));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(last).toContain('"Button"');
    expect(last).not.toContain('"Heading"');
  });

  it('shows inline note when no other valid candidates exist for this position', async () => {
    const ALL_CYCLE = [
      { name: 'Card', slots: [{ name: 'header', allowedComponents: ['Heading'] }] },
      { name: 'Heading', slots: [] },
      { name: 'X', slots: [{ name: 'r', allowedComponents: ['Card'] }] },
    ];
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={CARD}
        width={80}
        height={25}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={ALL_CYCLE}
        currentComponentName="Card"
      />,
    );
    await navigateToAllowedComponentsRow(stdin);
    stdin.write('\x1b[C');
    await new Promise((r) => setTimeout(r, 30));
    expect(lastFrame() ?? '').toContain('Heading');
  });

  it('hint line includes ←→ cycle when entries are present', async () => {
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={CARD}
        width={80}
        height={25}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={PROJECT_GRAPH}
        currentComponentName="Card"
      />,
    );
    await navigateToAllowedComponentsRow(stdin);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[←→] cycle');
    expect(frame).toContain('[a]dd');
  });

  it('regression: ← / → is a no-op when projectSlotGraph is omitted (free-text-only)', async () => {
    const onChange = vi.fn();
    const { stdin } = render(
      <FieldEditor value={CARD} width={80} height={25} onChange={onChange} onSave={vi.fn()} onDiscard={vi.fn()} />,
    );
    await navigateToAllowedComponentsRow(stdin);
    onChange.mockClear();
    stdin.write('\x1b[C');
    await new Promise((r) => setTimeout(r, 30));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('regression: add-mode picker still works', async () => {
    const onChange = vi.fn();
    const { stdin, lastFrame } = render(
      <FieldEditor
        value={CARD}
        width={80}
        height={25}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        projectSlotGraph={PROJECT_GRAPH}
        currentComponentName="Card"
      />,
    );
    await navigateToAllowedComponentsRow(stdin);
    stdin.write('a');
    await new Promise((r) => setTimeout(r, 30));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('candidates (↑↓ cycle, Enter to add):');
  });
});

describe('FieldEditor — onDirtyChange + discardTrigger (T5)', () => {
  async function enterStringDescriptionEdit(stdin: { write: (data: string) => void }): Promise<void> {
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
  }

  it('fires onDirtyChange(false) at mount (no edits)', async () => {
    const onDirtyChange = vi.fn();
    render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    await tick();
    expect(onDirtyChange).toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('fires onDirtyChange(true) after a real edit', async () => {
    const onDirtyChange = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    await tick();
    await enterStringDescriptionEdit(stdin);
    stdin.write('Q');
    await tick();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('fires onDirtyChange(false) after Ctrl+S (save clears the baseline)', async () => {
    const onDirtyChange = vi.fn();
    const onSave = vi.fn();
    const { stdin } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={onSave}
        onDiscard={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    await tick();
    await enterStringDescriptionEdit(stdin);
    stdin.write('Q');
    await tick();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    stdin.write('\x13');
    await tick();
    expect(onSave).toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('discardTrigger increments revert the draft and fire onDirtyChange(false)', async () => {
    const onDirtyChange = vi.fn();
    const onChange = vi.fn();
    const { stdin, rerender } = render(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onDirtyChange={onDirtyChange}
        discardTrigger={0}
      />,
    );
    await tick();
    await enterStringDescriptionEdit(stdin);
    stdin.write('Q');
    await tick();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    onChange.mockClear();
    rerender(
      <FieldEditor
        value={STRING_COMPONENT}
        width={80}
        height={20}
        onChange={onChange}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onDirtyChange={onDirtyChange}
        discardTrigger={1}
      />,
    );
    await tick();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalled();
  });
});

describe('FieldEditor — BD4 initialFocusTarget', () => {
  const MULTI_PROP_COMPONENT = JSON.stringify(
    {
      Card: {
        $type: 'component',
        $properties: {
          alpha: { $type: 'string', $category: 'content', $description: 'ALPHA_DESC' },
          bravo: { $type: 'string', $category: 'content', $description: 'BRAVO_DESC' },
          charlie: { $type: 'string', $category: 'content', $description: 'CHARLIE_DESC' },
        },
      },
    },
    null,
    2,
  );

  const PROPS_AND_SLOTS_COMPONENT = JSON.stringify(
    {
      Layout: {
        $type: 'component',
        $properties: {
          heading: { $type: 'string', $category: 'content', $description: 'HEADING_DESC' },
        },
        $slots: {
          main: { $description: 'MAIN_SLOT_DESC' },
          aside: { $description: 'ASIDE_SLOT_DESC' },
        },
      },
    },
    null,
    2,
  );

  it('seeds focus to the named prop (not the first) — its desc sub-row renders', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={MULTI_PROP_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        initialFocusTarget={{ kind: 'prop', name: 'charlie' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('CHARLIE_DESC');
    expect(frame).not.toContain('ALPHA_DESC');
  });

  it('seeds focus to the named slot — its desc sub-row renders', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={PROPS_AND_SLOTS_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        initialFocusTarget={{ kind: 'slot', name: 'aside' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ASIDE_SLOT_DESC');
    expect(frame).not.toContain('HEADING_DESC');
  });

  it('falls back to the first prop when the target name does not resolve', () => {
    const { lastFrame } = render(
      <FieldEditor
        value={MULTI_PROP_COMPONENT}
        width={80}
        height={20}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        initialFocusTarget={{ kind: 'prop', name: 'does-not-exist' }}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ALPHA_DESC');
    expect(frame).not.toContain('CHARLIE_DESC');
  });
});

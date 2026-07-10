import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractVueTsxComponents } from '@contentful/experience-design-system-extraction';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

describe('VueTsxComponentExtractor', () => {
  it('extracts Vuetify-style genericComponent TSX exports as vue components', async () => {
    const filePath = await writeFixture(
      'VBanner.tsx',
      `
      type PropType<T> = T;

      type VBannerSlots = {
        default: never;
        actions: { active: boolean };
      };

      const IconValue = {} as PropType<string>;
      const DefaultsShape = {} as PropType<{ theme?: string }>;

      function propsFactory<T extends Record<string, unknown>>(props: T, _name: string) {
        return () => props;
      }

      function genericComponent<T = unknown>(_exposeDefaults?: boolean) {
        return (options: {
          name?: string;
          props?: unknown;
          setup?: (props: unknown, context: { slots: T }) => unknown;
        }) => options;
      }

      const makeBaseProps = () => ({
        baseOnly: Boolean,
      });

      export const makeVBannerProps = propsFactory({
        title: String,
        count: Number,
        visible: {
          type: Boolean,
          default: true,
        },
        icon: [String, Number] as PropType<string | number>,
        defaults: Object as PropType<{ theme?: string }>,
        ...makeBaseProps(),
      }, 'VBanner');

      export const VBanner = genericComponent<VBannerSlots>()({
        name: 'VBanner',
        props: makeVBannerProps(),
        setup (_props, { slots }) {
          return () => [slots.default?.(), slots.actions?.({ active: true })];
        },
      });
    `,
    );

    const result = await extractVueTsxComponents([filePath]);
    const banner = result.components.find((component) => component.name === 'VBanner');

    expect(banner).toBeDefined();
    expect(banner?.framework).toBe('vue');
    expect(banner?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'title',
          type: 'string',
          required: false,
        }),
        expect.objectContaining({
          name: 'count',
          type: 'number',
          required: false,
        }),
        expect.objectContaining({
          name: 'visible',
          type: 'boolean',
          required: false,
          defaultValue: 'true',
        }),
        expect.objectContaining({
          name: 'icon',
          type: 'string | number',
          required: false,
        }),
        expect.objectContaining({ name: 'defaults', required: false }),
        expect.objectContaining({
          name: 'baseOnly',
          type: 'boolean',
          required: false,
        }),
      ]),
    );
    expect(banner?.props.find((prop) => prop.name === 'defaults')?.type).toContain('theme?: string');
    expect(banner?.slots).toContainEqual({ name: 'default', isDefault: true });
    expect(banner?.slots).toContainEqual({ name: 'actions', isDefault: false });
  });

  it('falls back to the export name when a Vuetify-style genericComponent options object omits name', async () => {
    const filePath = await writeFixture(
      'VAnonymous.tsx',
      `
      function propsFactory<T extends Record<string, unknown>>(props: T, _name: string) {
        return () => props;
      }

      function genericComponent<T = unknown>(_arg?: T) {
        return (options: { props?: unknown; setup?: (props: unknown) => unknown }) => options;
      }

      const makeVAnonymousProps = propsFactory({
        message: String,
      }, 'VAnonymous');

      export const VAnonymous = genericComponent()({
        props: makeVAnonymousProps(),
        setup () {
          return () => null;
        },
      });
    `,
    );

    const result = await extractVueTsxComponents([filePath]);
    const anonymous = result.components.find((component) => component.name === 'VAnonymous');

    expect(anonymous).toBeDefined();
    expect(anonymous?.framework).toBe('vue');
    expect(anonymous?.props).toEqual([
      expect.objectContaining({
        name: 'message',
        type: 'string',
        required: false,
      }),
    ]);
  });

  it('extracts Vue defineComponent TSX exports and resolves spread-composed props', async () => {
    const filePath = await writeFixture(
      'VColorPicker.tsx',
      `
      type PropType<T> = T;

      function propsFactory<T extends Record<string, unknown>>(props: T, _name: string) {
        return () => props;
      }

      function defineComponent(options: {
        name?: string;
        props?: unknown;
        setup?: (props: unknown, context: { slots: { default?: () => unknown; preview?: () => unknown } }) => unknown;
      }) {
        return options;
      }

      function pick<T extends Record<string, unknown>, K extends keyof T>(props: T, _keys: readonly K[]) {
        return props as Pick<T, K>;
      }

      function omit<T extends Record<string, unknown>, K extends keyof T>(props: T, _keys: readonly K[]) {
        return props as Omit<T, K>;
      }

      const makeSharedProps = () => ({
        disabled: Boolean,
      });

      const makePreviewProps = propsFactory({
        hideEyeDropper: Boolean,
        eyeDropperIcon: String,
        previewClass: String,
      }, 'Preview');

      export const makeVColorPickerProps = propsFactory({
        canvasHeight: {
          type: [String, Number],
          default: 150,
        },
        mode: String as PropType<'rgb' | 'rgba'>,
        ...makeSharedProps(),
        ...pick(makePreviewProps(), ['hideEyeDropper', 'eyeDropperIcon']),
        ...omit(makePreviewProps(), ['previewClass']),
      }, 'VColorPicker');

      export const VColorPicker = defineComponent({
        name: 'VColorPicker',
        props: makeVColorPickerProps(),
        setup (_props, { slots }) {
          return () => [slots.default?.(), slots.preview?.()];
        },
      });
    `,
    );

    const result = await extractVueTsxComponents([filePath]);
    const colorPicker = result.components.find((component) => component.name === 'VColorPicker');

    expect(colorPicker).toBeDefined();
    expect(colorPicker?.framework).toBe('vue');
    expect(colorPicker?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'canvasHeight',
          type: 'number | string',
          required: false,
          defaultValue: '150',
        }),
        expect.objectContaining({
          name: 'mode',
          type: "'rgb' | 'rgba'",
          required: false,
        }),
        expect.objectContaining({
          name: 'disabled',
          type: 'boolean',
          required: false,
        }),
        expect.objectContaining({
          name: 'hideEyeDropper',
          type: 'boolean',
          required: false,
        }),
        expect.objectContaining({
          name: 'eyeDropperIcon',
          type: 'string',
          required: false,
        }),
      ]),
    );
    expect(colorPicker?.props.find((prop) => prop.name === 'previewClass')).toBeUndefined();
    expect(colorPicker?.slots).toContainEqual({
      name: 'default',
      isDefault: true,
    });
    expect(colorPicker?.slots).toContainEqual({
      name: 'preview',
      isDefault: false,
    });
  });

  it('extracts nested spread-only props factories for Vuetify-style genericComponent exports', async () => {
    const filePath = await writeFixture(
      'VDataTable.tsx',
      `
      function propsFactory<T extends Record<string, unknown>>(props: T, _name: string) {
        return () => props;
      }

      function genericComponent<T = unknown>(_arg?: T) {
        return (options: {
          name?: string;
          props?: unknown;
          setup?: (props: unknown, context: { slots: T }) => unknown;
        }) => options;
      }

      const makeBaseProps = propsFactory({
        search: String,
        hideDefaultBody: Boolean,
      }, 'Base');

      const makePaginatedProps = propsFactory({
        page: Number,
        ...makeBaseProps(),
      }, 'Paginated');

      export const makeVDataTableProps = propsFactory({
        ...makePaginatedProps(),
      }, 'VDataTable');

      export const VDataTable = genericComponent<{ default: never }>()({
        name: 'VDataTable',
        props: makeVDataTableProps(),
        setup (_props, { slots }) {
          return () => slots.default?.();
        },
      });
    `,
    );

    const result = await extractVueTsxComponents([filePath]);
    const dataTable = result.components.find((component) => component.name === 'VDataTable');

    expect(dataTable).toBeDefined();
    expect(dataTable?.framework).toBe('vue');
    expect(dataTable?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'page',
          type: 'number',
          required: false,
        }),
        expect.objectContaining({
          name: 'search',
          type: 'string',
          required: false,
        }),
        expect.objectContaining({
          name: 'hideDefaultBody',
          type: 'boolean',
          required: false,
        }),
      ]),
    );
  });

  it('resolves Vuetify-style aliased props factories from repo-local tsconfig paths', async () => {
    const tsconfigPath = await writeFixture(
      'repo/packages/vuetify/tsconfig.json',
      `
      {
        "compilerOptions": {
          "paths": {
            "@/*": ["./src/*"]
          }
        }
      }
    `,
    );

    const utilPath = await writeFixture(
      'repo/packages/vuetify/src/components/util.tsx',
      `
      export type PropType<T> = T;

      export function propsFactory<T extends Record<string, unknown>>(props: T, _name: string) {
        return () => props;
      }

      export function genericComponent<T = unknown>(_arg?: T) {
        return (options: {
          name?: string;
          props?: unknown;
          setup?: (props: unknown, context: { slots: T }) => unknown;
        }) => options;
      }

      export function omit<T extends Record<string, unknown>, K extends keyof T>(props: T, _keys: readonly K[]) {
        return props as Omit<T, K>;
      }
    `,
    );

    const overlayPath = await writeFixture(
      'repo/packages/vuetify/src/components/VOverlay/VOverlay.tsx',
      `
      import { propsFactory, type PropType } from '../util';

      const makeActivatorProps = () => ({
        activator: String,
        activatorProps: Object as PropType<Record<string, unknown>>,
      });

      export const makeVOverlayProps = propsFactory({
        modelValue: Boolean,
        persistent: Boolean,
        scrim: {
          type: Boolean,
          default: true,
        },
        disableInitialFocus: Boolean,
        ...makeActivatorProps(),
      }, 'VOverlay');
    `,
    );

    const dialogPath = await writeFixture(
      'repo/packages/vuetify/src/components/VDialog/VDialog.tsx',
      `
      import { genericComponent, omit, propsFactory } from '../util';
      import { makeVOverlayProps } from '@/components/VOverlay/VOverlay';

      export const makeVDialogProps = propsFactory({
        fullscreen: Boolean,
        scrollable: Boolean,
        ...omit(makeVOverlayProps(), ['disableInitialFocus']),
      }, 'VDialog');

      export const VDialog = genericComponent<{ default: never }>()({
        name: 'VDialog',
        props: makeVDialogProps(),
        setup (_props, { slots }) {
          return () => slots.default?.();
        },
      });
    `,
    );

    const inputPath = await writeFixture(
      'repo/packages/vuetify/src/components/VInput/VInput.tsx',
      `
      import { propsFactory } from '../util';

      export const makeVInputProps = propsFactory({
        id: String,
        color: String,
        modelValue: String,
      }, 'VInput');
    `,
    );

    const textFieldPath = await writeFixture(
      'repo/packages/vuetify/src/components/VTextField/VTextField.tsx',
      `
      import { omit, propsFactory } from '../util';
      import { makeVInputProps } from '@/components/VInput/VInput';

      export const makeVTextFieldProps = propsFactory({
        placeholder: String,
        validationValue: String,
        ...omit(makeVInputProps(), ['modelValue']),
      }, 'VTextField');
    `,
    );

    const numberInputPath = await writeFixture(
      'repo/packages/vuetify/src/components/VNumberInput/VNumberInput.tsx',
      `
      import { genericComponent, omit, propsFactory } from '../util';
      import { makeVTextFieldProps } from '@/components/VTextField/VTextField';

      export const makeVNumberInputProps = propsFactory({
        min: Number,
        max: Number,
        ...omit(makeVTextFieldProps(), ['validationValue']),
      }, 'VNumberInput');

      export const VNumberInput = genericComponent<{ default: never }>()({
        name: 'VNumberInput',
        props: makeVNumberInputProps(),
        setup (_props, { slots }) {
          return () => slots.default?.();
        },
      });
    `,
    );

    const result = await extractVueTsxComponents([
      utilPath,
      overlayPath,
      dialogPath,
      inputPath,
      textFieldPath,
      numberInputPath,
    ]);

    expect(tsconfigPath).toBeDefined();

    const dialog = result.components.find((component) => component.name === 'VDialog');
    const numberInput = result.components.find((component) => component.name === 'VNumberInput');

    expect(dialog).toBeDefined();
    expect(dialog?.framework).toBe('vue');
    expect(dialog?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'fullscreen',
          type: 'boolean',
          required: false,
        }),
        expect.objectContaining({
          name: 'scrollable',
          type: 'boolean',
          required: false,
        }),
        expect.objectContaining({
          name: 'modelValue',
          type: 'boolean',
          required: false,
        }),
        expect.objectContaining({
          name: 'persistent',
          type: 'boolean',
          required: false,
        }),
        expect.objectContaining({
          name: 'scrim',
          type: 'boolean',
          required: false,
          defaultValue: 'true',
        }),
        expect.objectContaining({
          name: 'activator',
          type: 'string',
          required: false,
        }),
        expect.objectContaining({ name: 'activatorProps', required: false }),
      ]),
    );
    expect(dialog?.props.find((prop) => prop.name === 'disableInitialFocus')).toBeUndefined();

    expect(numberInput).toBeDefined();
    expect(numberInput?.framework).toBe('vue');
    expect(numberInput?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'min',
          type: 'number',
          required: false,
        }),
        expect.objectContaining({
          name: 'max',
          type: 'number',
          required: false,
        }),
        expect.objectContaining({
          name: 'placeholder',
          type: 'string',
          required: false,
        }),
        expect.objectContaining({
          name: 'id',
          type: 'string',
          required: false,
        }),
        expect.objectContaining({
          name: 'color',
          type: 'string',
          required: false,
        }),
      ]),
    );
    expect(numberInput?.props.find((prop) => prop.name === 'modelValue')).toBeUndefined();
    expect(numberInput?.props.find((prop) => prop.name === 'validationValue')).toBeUndefined();
  });

  it('normalizes quoted string-literal prop keys in Vuetify-style props factories', async () => {
    const filePath = await writeFixture(
      'VQuotedEvents.tsx',
      `
      function propsFactory<T extends Record<string, unknown>>(props: T, _name: string) {
        return () => props;
      }

      function genericComponent<T = unknown>(_arg?: T) {
        return (options: {
          name?: string;
          props?: unknown;
          setup?: (props: unknown, context: { slots: T }) => unknown;
        }) => options;
      }

      export const makeVQuotedEventsProps = propsFactory({
        'onClick:append': Function,
        'onClick:appendInner': Function,
        label: String,
      }, 'VQuotedEvents');

      export const VQuotedEvents = genericComponent<{ default: never }>()({
        name: 'VQuotedEvents',
        props: makeVQuotedEventsProps(),
        setup (_props, { slots }) {
          return () => slots.default?.();
        },
      });
    `,
    );

    const result = await extractVueTsxComponents([filePath]);
    const component = result.components.find((entry) => entry.name === 'VQuotedEvents');

    expect(component).toBeDefined();
    expect(component?.props).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'onClick:append', required: false }),
        expect.objectContaining({
          name: 'onClick:appendInner',
          required: false,
        }),
        expect.objectContaining({
          name: 'label',
          type: 'string',
          required: false,
        }),
      ]),
    );
    expect(component?.props.find((prop) => prop.name === "'onClick:append'")).toBeUndefined();
    expect(component?.props.find((prop) => prop.name === "'onClick:appendInner'")).toBeUndefined();
  });
});
